import {
  createDefaultGlobalCategoryRules,
  NAVIGATION_CATEGORY_ORDER,
} from "./navigation-categories";
import type {
  CategoryRuleMap,
  ExtensionState,
  NavigationCategory,
  NavigationDisposition,
  NavigationMode,
  RuleMode,
  SiteCategoryRule,
  SiteCategoryRuleMap,
} from "./types";
import { normalizePageUrl } from "./url";

const DEFAULT_STATE: ExtensionState = {
  schemaVersion: 2,
  globalMode: "new-tab",
  globalCategoryRules: createDefaultGlobalCategoryRules(),
  siteCategoryRules: {},
  siteRules: {},
  pageRules: {},
  disabledSites: [],
};
const AUTHORIZED_SITES_KEY = "authorizedSites";

export async function ensureState(): Promise<ExtensionState> {
  const state = await readState();
  await chrome.storage.sync.set(state);
  return state;
}

export async function readState(): Promise<ExtensionState> {
  const stored = await chrome.storage.sync.get([
    "schemaVersion",
    "globalMode",
    "globalCategoryRules",
    "siteCategoryRules",
    "siteRules",
    "pageRules",
    "disabledSites",
  ]);
  return normalizePersistedState(stored);
}

export async function replaceState(nextStateInput: unknown): Promise<ExtensionState> {
  const nextState = parseImportedState(nextStateInput);
  await chrome.storage.sync.set(nextState);
  return nextState;
}

export async function hasSiteAuthorizationRecord(hostname: string): Promise<boolean> {
  const sites = await readAuthorizedSites();
  return sites.includes(normalizeHostname(hostname));
}

export async function markSiteAuthorized(hostname: string): Promise<void> {
  const sites = new Set(await readAuthorizedSites());
  sites.add(normalizeHostname(hostname));
  await writeAuthorizedSites([...sites]);
}

export async function removeSiteAuthorizationRecord(hostname: string): Promise<void> {
  const sites = new Set(await readAuthorizedSites());
  sites.delete(normalizeHostname(hostname));
  await writeAuthorizedSites([...sites]);
}

export async function removeSiteAuthorizationRecords(hostnames: string[]): Promise<void> {
  const sites = new Set(await readAuthorizedSites());
  hostnames.forEach((hostname) => {
    sites.delete(normalizeHostname(hostname));
  });
  await writeAuthorizedSites([...sites]);
}

export async function clearSiteAuthorizationRecords(): Promise<void> {
  await chrome.storage.local.set({ [AUTHORIZED_SITES_KEY]: [] });
}

export async function writeGlobalMode(mode: NavigationMode): Promise<ExtensionState> {
  return updateState((state) => ({ ...state, globalMode: mode }));
}

export async function writeGlobalCategoryRule(
  category: NavigationCategory,
  disposition: NavigationDisposition,
): Promise<ExtensionState> {
  return updateState((state) => ({
    ...state,
    globalCategoryRules: {
      ...state.globalCategoryRules,
      [category]: disposition,
    },
  }));
}

export async function writeSiteEnabled(
  hostname: string,
  enabled: boolean,
): Promise<ExtensionState> {
  const normalizedHostname = normalizeHostname(hostname);
  return updateState((state) => {
    const nextDisabledSites = new Set(state.disabledSites);
    if (enabled) {
      nextDisabledSites.delete(normalizedHostname);
    } else {
      nextDisabledSites.add(normalizedHostname);
    }

    return {
      ...state,
      disabledSites: [...nextDisabledSites].sort(),
    };
  });
}

export async function writeSiteRule(
  hostname: string,
  mode: RuleMode,
): Promise<ExtensionState> {
  const normalizedHostname = normalizeHostname(hostname);
  return updateState((state) => ({
    ...state,
    siteRules: writeRuleMapEntry(state.siteRules, normalizedHostname, mode),
  }));
}

export async function writePageRule(
  rawUrl: string,
  mode: RuleMode,
): Promise<ExtensionState> {
  const pageKey = normalizePageUrl(rawUrl);
  return updateState((state) => ({
    ...state,
    pageRules: writeRuleMapEntry(state.pageRules, pageKey, mode),
  }));
}

export async function writeSiteCategoryRule(
  hostname: string,
  category: NavigationCategory,
  rule: SiteCategoryRule,
): Promise<ExtensionState> {
  const normalizedHostname = normalizeHostname(hostname);
  return updateState((state) => {
    const nextSiteCategoryRules = { ...state.siteCategoryRules };
    const currentRuleMap = sanitizeSiteCategoryRuleMap(nextSiteCategoryRules[normalizedHostname]);

    if (rule === "inherit") {
      delete currentRuleMap[category];
    } else {
      currentRuleMap[category] = rule;
    }

    if (Object.keys(currentRuleMap).length === 0) {
      delete nextSiteCategoryRules[normalizedHostname];
    } else {
      nextSiteCategoryRules[normalizedHostname] = currentRuleMap;
    }

    return {
      ...state,
      siteCategoryRules: nextSiteCategoryRules,
    };
  });
}

export function parseImportedState(value: unknown): ExtensionState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("导入配置必须是一个 JSON 对象。");
  }

  const record = value as Record<string, unknown>;

  if (!("globalMode" in record)) {
    throw new Error("导入配置缺少 globalMode 字段。");
  }
  if (!("siteRules" in record)) {
    throw new Error("导入配置缺少 siteRules 字段。");
  }
  if (!("pageRules" in record)) {
    throw new Error("导入配置缺少 pageRules 字段。");
  }

  return {
    schemaVersion: 2,
    globalMode: parseNavigationMode(record.globalMode, "globalMode"),
    globalCategoryRules:
      "globalCategoryRules" in record
        ? parseGlobalCategoryRules(record.globalCategoryRules)
        : createDefaultGlobalCategoryRules(),
    siteCategoryRules:
      "siteCategoryRules" in record
        ? parseSiteCategoryRules(record.siteCategoryRules)
        : {},
    siteRules: parseRuleMap(record.siteRules, "siteRules"),
    pageRules: parseRuleMap(record.pageRules, "pageRules"),
    disabledSites:
      "disabledSites" in record ? parseDisabledSites(record.disabledSites) : DEFAULT_STATE.disabledSites,
  };
}

async function updateState(
  updater: (state: ExtensionState) => ExtensionState,
): Promise<ExtensionState> {
  const state = await readState();
  const nextState = updater(state);
  await chrome.storage.sync.set(nextState);
  return nextState;
}

function normalizePersistedState(value: Record<string, unknown>): ExtensionState {
  return {
    schemaVersion: 2,
    globalMode: parseNavigationMode(value.globalMode, "globalMode", DEFAULT_STATE.globalMode),
    globalCategoryRules: sanitizeGlobalCategoryRules(value.globalCategoryRules),
    siteCategoryRules: sanitizeSiteCategoryRules(value.siteCategoryRules),
    siteRules: isRuleMap(value.siteRules) ? value.siteRules : {},
    pageRules: isRuleMap(value.pageRules) ? value.pageRules : {},
    disabledSites: sanitizeDisabledSites(value.disabledSites),
  };
}

function isRuleMap(value: unknown): value is Record<string, NavigationMode> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => entry === "same-tab" || entry === "new-tab");
}

function sanitizeGlobalCategoryRules(value: unknown): CategoryRuleMap {
  const defaults = createDefaultGlobalCategoryRules();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return defaults;
  }

  const record = value as Record<string, unknown>;
  return NAVIGATION_CATEGORY_ORDER.reduce<CategoryRuleMap>((accumulator, category) => {
    accumulator[category] = parseNavigationDisposition(
      record[category],
      `globalCategoryRules.${category}`,
      defaults[category],
    );
    return accumulator;
  }, { ...defaults });
}

function sanitizeSiteCategoryRules(value: unknown): Record<string, SiteCategoryRuleMap> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, SiteCategoryRuleMap>>((accumulator, [key, entry]) => {
    const normalizedKey = normalizeHostname(key);
    const ruleMap = sanitizeSiteCategoryRuleMap(entry);
    if (normalizedKey && Object.keys(ruleMap).length > 0) {
      accumulator[normalizedKey] = ruleMap;
    }
    return accumulator;
  }, {});
}

function sanitizeSiteCategoryRuleMap(value: unknown): SiteCategoryRuleMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  return NAVIGATION_CATEGORY_ORDER.reduce<SiteCategoryRuleMap>((accumulator, category) => {
    const parsed = parseSiteCategoryRule(record[category], `siteCategoryRules.${category}`);
    if (parsed !== "inherit") {
      accumulator[category] = parsed;
    }
    return accumulator;
  }, {});
}

function parseGlobalCategoryRules(value: unknown): CategoryRuleMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("globalCategoryRules 必须是对象。");
  }

  const record = value as Record<string, unknown>;
  return NAVIGATION_CATEGORY_ORDER.reduce<CategoryRuleMap>((accumulator, category) => {
    accumulator[category] = parseNavigationDisposition(
      record[category],
      `globalCategoryRules.${category}`,
    );
    return accumulator;
  }, createDefaultGlobalCategoryRules());
}

function parseSiteCategoryRules(value: unknown): Record<string, SiteCategoryRuleMap> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("siteCategoryRules 必须是对象。");
  }

  return Object.entries(value).reduce<Record<string, SiteCategoryRuleMap>>((accumulator, [key, entry]) => {
    const normalizedKey = normalizeHostname(key);
    const parsedRuleMap = parseSiteCategoryRuleMap(entry, `siteCategoryRules.${key}`);
    if (normalizedKey && Object.keys(parsedRuleMap).length > 0) {
      accumulator[normalizedKey] = parsedRuleMap;
    }
    return accumulator;
  }, {});
}

function parseSiteCategoryRuleMap(value: unknown, fieldName: string): SiteCategoryRuleMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是对象。`);
  }

  const record = value as Record<string, unknown>;
  return NAVIGATION_CATEGORY_ORDER.reduce<SiteCategoryRuleMap>((accumulator, category) => {
    const parsed = parseSiteCategoryRule(record[category], `${fieldName}.${category}`);
    if (parsed !== "inherit") {
      accumulator[category] = parsed;
    }
    return accumulator;
  }, {});
}

function parseRuleMap(
  value: unknown,
  fieldName: "siteRules" | "pageRules",
): Record<string, NavigationMode> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是对象。`);
  }

  return Object.entries(value).reduce<Record<string, NavigationMode>>((accumulator, [key, entry]) => {
    accumulator[key] = parseNavigationMode(entry, `${fieldName}.${key}`);
    return accumulator;
  }, {});
}

function parseDisabledSites(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("disabledSites 必须是字符串数组。");
  }

  if (!value.every((entry) => typeof entry === "string")) {
    throw new Error("disabledSites 只能包含字符串。");
  }

  return sanitizeDisabledSites(value);
}

function parseNavigationMode(
  value: unknown,
  fieldName: string,
  fallback?: NavigationMode,
): NavigationMode {
  if (value === "same-tab" || value === "new-tab") {
    return value;
  }

  if (fallback) {
    return fallback;
  }

  throw new Error(`${fieldName} 只能是 same-tab 或 new-tab。`);
}

function parseNavigationDisposition(
  value: unknown,
  fieldName: string,
  fallback?: NavigationDisposition,
): NavigationDisposition {
  if (value === "same-tab" || value === "new-tab" || value === "preserve-native") {
    return value;
  }

  if (fallback) {
    return fallback;
  }

  throw new Error(`${fieldName} 只能是 same-tab、new-tab 或 preserve-native。`);
}

function parseSiteCategoryRule(
  value: unknown,
  fieldName: string,
): SiteCategoryRule {
  if (
    value === undefined ||
    value === null ||
    value === "inherit" ||
    value === "same-tab" ||
    value === "new-tab" ||
    value === "preserve-native"
  ) {
    return value ?? "inherit";
  }

  throw new Error(`${fieldName} 只能是 inherit、same-tab、new-tab 或 preserve-native。`);
}

function writeRuleMapEntry<T extends string>(
  ruleMap: Record<string, T>,
  key: string,
  mode: T | "inherit",
): Record<string, T> {
  const nextRules = { ...ruleMap };
  if (mode === "inherit") {
    delete nextRules[key];
  } else {
    nextRules[key] = mode;
  }
  return nextRules;
}

async function readAuthorizedSites(): Promise<string[]> {
  const stored = await chrome.storage.local.get(AUTHORIZED_SITES_KEY);
  return sanitizeAuthorizedSites(stored[AUTHORIZED_SITES_KEY]);
}

async function writeAuthorizedSites(hostnames: string[]): Promise<void> {
  await chrome.storage.local.set({
    [AUTHORIZED_SITES_KEY]: sanitizeAuthorizedSites(hostnames),
  });
}

function sanitizeAuthorizedSites(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => normalizeHostname(entry)),
  )].sort();
}

function sanitizeDisabledSites(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => normalizeHostname(entry)),
  )].sort();
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}
