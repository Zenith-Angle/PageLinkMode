import type { ExtensionState, NavigationMode, RuleMode } from "./types";
import { normalizePageUrl } from "./url";

const DEFAULT_STATE: ExtensionState = {
  globalMode: "same-tab",
  siteRules: {},
  pageRules: {},
};
const AUTHORIZED_SITES_KEY = "authorizedSites";

export async function ensureState(): Promise<ExtensionState> {
  const state = await readState();
  await chrome.storage.sync.set(state);
  return state;
}

export async function readState(): Promise<ExtensionState> {
  const stored = await chrome.storage.sync.get([
    "globalMode",
    "siteRules",
    "pageRules",
  ]);
  const globalMode = stored.globalMode;
  const siteRules = stored.siteRules;
  const pageRules = stored.pageRules;
  return {
    globalMode:
      globalMode === "same-tab" || globalMode === "new-tab"
        ? globalMode
        : DEFAULT_STATE.globalMode,
    siteRules: isRuleMap(siteRules) ? siteRules : {},
    pageRules: isRuleMap(pageRules) ? pageRules : {},
  };
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
  const state = await readState();
  const nextState = { ...state, globalMode: mode };
  await chrome.storage.sync.set(nextState);
  return nextState;
}

function isRuleMap(value: unknown): value is Record<string, NavigationMode> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => entry === "same-tab" || entry === "new-tab");
}

function parseImportedState(value: unknown): ExtensionState {
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
    globalMode: parseNavigationMode(record.globalMode, "globalMode"),
    siteRules: parseRuleMap(record.siteRules, "siteRules"),
    pageRules: parseRuleMap(record.pageRules, "pageRules"),
  };
}

function parseNavigationMode(value: unknown, fieldName: string): NavigationMode {
  if (value === "same-tab" || value === "new-tab") {
    return value;
  }

  throw new Error(`${fieldName} 只能是 same-tab 或 new-tab。`);
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

export async function writeSiteRule(
  hostname: string,
  mode: RuleMode,
): Promise<ExtensionState> {
  const state = await readState();
  const nextRules = { ...state.siteRules };
  if (mode === "inherit") {
    delete nextRules[hostname];
  } else {
    nextRules[hostname] = mode;
  }
  const nextState = { ...state, siteRules: nextRules };
  await chrome.storage.sync.set(nextState);
  return nextState;
}

export async function writePageRule(
  rawUrl: string,
  mode: RuleMode,
): Promise<ExtensionState> {
  const state = await readState();
  const pageKey = normalizePageUrl(rawUrl);
  const nextRules = { ...state.pageRules };
  if (mode === "inherit") {
    delete nextRules[pageKey];
  } else {
    nextRules[pageKey] = mode;
  }
  const nextState = { ...state, pageRules: nextRules };
  await chrome.storage.sync.set(nextState);
  return nextState;
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

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}
