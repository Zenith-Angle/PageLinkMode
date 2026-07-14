import {
  createDefaultGlobalCategoryRules,
  createPresetCategoryRules,
  DEFAULT_PRESET_ID,
  isHardNativeCategory,
  isSensitiveCategory,
  NAVIGATION_CATEGORY_ORDER,
} from "./navigation-categories";
import { validateRestrictedCssSelector, validateUrlMatcher } from "./personal-rules";
import type {
  BasicPresetId,
  BasicCategoryRule,
  CategoryRuleMap,
  ConfigurationBackup,
  ExtensionState,
  NavigationCategory,
  NavigationDisposition,
  PersonalRule,
  PersonalRuleMatch,
  RiskGrant,
  RuleMode,
  SiteCategoryRule,
  SiteCategoryRuleMap,
  UrlMatcher,
} from "./types";
import { getHostname, normalizePageUrl, parseUrl } from "./url";

const STATE_KEYS = [
  "schemaVersion",
  "presetId",
  "globalCategoryRules",
  "siteCategoryRules",
  "siteRules",
  "pageRules",
  "personalRules",
  "disabledSites",
] as const;
const LEGACY_SYNC_KEYS = [
  "schemaVersion",
  "takeoverScopeLevel",
  "globalMode",
  "globalCategoryRules",
  "siteCategoryRules",
  "siteRules",
  "pageRules",
  "disabledSites",
] as const;
const OBSOLETE_LOCAL_KEYS = ["globalMode", "takeoverScopeLevel"];
const AUTHORIZED_SITES_KEY = "authorizedSites";
const RISK_GRANTS_KEY = "riskGrants";

type LegacyCategory =
  | "same-origin-content-link"
  | "cross-origin-content-link"
  | "site-shell-navigation"
  | "pagination-navigation"
  | "image-viewer-link"
  | "auth-link"
  | "get-form-submit"
  | "non-get-form-submit"
  | "window-open"
  | "auth-window-open"
  | "image-window-open"
  | "named-or-popup-window-open";
type LegacyScopeLevel = 0 | 1 | 2 | 3 | 4;

const LEGACY_DEFAULT_RULES: Record<LegacyCategory, NavigationDisposition> = {
  "same-origin-content-link": "new-tab",
  "cross-origin-content-link": "new-tab",
  "site-shell-navigation": "same-tab",
  "pagination-navigation": "preserve-native",
  "image-viewer-link": "preserve-native",
  "auth-link": "preserve-native",
  "get-form-submit": "preserve-native",
  "non-get-form-submit": "preserve-native",
  "window-open": "new-tab",
  "auth-window-open": "preserve-native",
  "image-window-open": "preserve-native",
  "named-or-popup-window-open": "preserve-native",
};
const LEGACY_MINIMUM_SCOPE: Record<LegacyCategory, LegacyScopeLevel> = {
  "same-origin-content-link": 0,
  "cross-origin-content-link": 1,
  "site-shell-navigation": 1,
  "pagination-navigation": 2,
  "image-viewer-link": 2,
  "auth-link": 2,
  "get-form-submit": 3,
  "non-get-form-submit": 3,
  "window-open": 4,
  "auth-window-open": 4,
  "image-window-open": 4,
  "named-or-popup-window-open": 4,
};
const LEGACY_CATEGORY_MAP: Record<NavigationCategory, LegacyCategory> = {
  "link-same-origin": "same-origin-content-link",
  "link-same-site": "cross-origin-content-link",
  "link-cross-site": "cross-origin-content-link",
  "link-site-root": "site-shell-navigation",
  "link-primary-navigation": "site-shell-navigation",
  "link-breadcrumb-tab": "site-shell-navigation",
  "link-list-detail": "same-origin-content-link",
  "link-pagination": "pagination-navigation",
  "link-content-sequence": "pagination-navigation",
  "link-search-filter": "pagination-navigation",
  "link-image-gallery": "image-viewer-link",
  "link-document": "same-origin-content-link",
  "link-media": "same-origin-content-link",
  "link-spa-route": "same-origin-content-link",
  "link-auth-account": "auth-link",
  "link-payment-checkout": "auth-link",
  "form-search-get": "get-form-submit",
  "form-general-get": "get-form-submit",
  "form-non-get": "non-get-form-submit",
  "form-auth-payment": "non-get-form-submit",
  "open-same-origin": "window-open",
  "open-same-site": "window-open",
  "open-cross-site": "window-open",
  "open-image-gallery": "image-window-open",
  "open-document-media": "window-open",
  "open-auth-payment": "auth-window-open",
  "open-popup-named": "named-or-popup-window-open",
};
const PRESET_BY_LEGACY_SCOPE: Record<LegacyScopeLevel, Exclude<BasicPresetId, "custom">> = {
  0: "precise",
  1: "content",
  2: "broad",
  3: "deep",
  4: "widest",
};

const DEFAULT_STATE: ExtensionState = {
  schemaVersion: 4,
  presetId: DEFAULT_PRESET_ID,
  globalCategoryRules: createDefaultGlobalCategoryRules(),
  siteCategoryRules: {},
  siteRules: {},
  pageRules: {},
  personalRules: [],
  disabledSites: [],
};

let initializationTask: Promise<ExtensionState> | null = null;
let updateQueue: Promise<unknown> = Promise.resolve();

export function createDefaultState(): ExtensionState {
  return cloneState(DEFAULT_STATE);
}

export async function ensureState(): Promise<ExtensionState> {
  if (!initializationTask) {
    initializationTask = initializeState().finally(() => {
      initializationTask = null;
    });
  }
  return initializationTask;
}

export async function readState(): Promise<ExtensionState> {
  const stored = await chrome.storage.local.get([...STATE_KEYS]);
  if (stored.schemaVersion === 4) {
    return normalizePersistedState(stored);
  }
  return ensureState();
}

export async function replaceState(nextStateInput: unknown): Promise<ExtensionState> {
  const nextState = parseImportedState(nextStateInput);
  await writeState(nextState);
  return nextState;
}

export function createConfigurationBackup(
  state: ExtensionState,
  extensionVersion: string,
  now = new Date(),
): ConfigurationBackup {
  const normalizedExtensionVersion = requireNonEmptyString(extensionVersion, "extensionVersion");
  if (!Number.isFinite(now.getTime())) {
    throw new Error("exportedAt 必须是有效时间。");
  }
  return {
    formatVersion: 1,
    extensionVersion: normalizedExtensionVersion,
    exportedAt: now.toISOString(),
    state: normalizePersistedState(state as unknown as Record<string, unknown>),
  };
}

export function parseImportedState(value: unknown): ExtensionState {
  const record = requireRecord(value, "导入配置必须是一个 JSON 对象。");
  const backupState = parseBackupEnvelope(record);
  const rawState = backupState ?? record;
  const schemaVersion = parseImportedSchemaVersion(rawState.schemaVersion, backupState !== null);
  if (schemaVersion !== undefined && schemaVersion > 4) {
    throw new Error(`该配置来自更高的 schema v${schemaVersion}，当前版本无法安全导入。`);
  }
  if (schemaVersion === 4 || (schemaVersion === undefined && ("personalRules" in rawState || "presetId" in rawState))) {
    return parseV4State(rawState, true, true);
  }
  return migrateLegacyState(rawState, true);
}

export async function writePreset(presetId: Exclude<BasicPresetId, "custom">): Promise<ExtensionState> {
  return updateState((state) => ({
    ...state,
    presetId,
    globalCategoryRules: createPresetCategoryRules(presetId),
  }));
}

export async function writeGlobalCategoryRule(
  category: NavigationCategory,
  disposition: BasicCategoryRule,
): Promise<ExtensionState> {
  const safeDisposition = isProtectedCategory(category) ? "preserve-native" : disposition;
  return updateState((state) => ({
    ...state,
    presetId: "custom",
    globalCategoryRules: { ...state.globalCategoryRules, [category]: safeDisposition },
  }));
}

export async function writeSiteEnabled(hostname: string, enabled: boolean): Promise<ExtensionState> {
  const normalizedHostname = normalizeHostname(hostname);
  return updateState((state) => {
    const disabledSites = new Set(state.disabledSites);
    enabled ? disabledSites.delete(normalizedHostname) : disabledSites.add(normalizedHostname);
    return { ...state, disabledSites: [...disabledSites].sort() };
  });
}

export async function writeSiteRule(hostname: string, mode: RuleMode): Promise<ExtensionState> {
  const normalizedHostname = normalizeHostname(hostname);
  return updateState((state) => ({
    ...state,
    siteRules: writeRuleMapEntry(state.siteRules, normalizedHostname, mode),
  }));
}

export async function writePageRule(rawUrl: string, mode: RuleMode): Promise<ExtensionState> {
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
  const safeRule = isProtectedCategory(category) ? "inherit" : rule;
  return updateState((state) => {
    const siteCategoryRules = { ...state.siteCategoryRules };
    const categoryRules = { ...(siteCategoryRules[normalizedHostname] ?? {}) };
    if (safeRule === "inherit") {
      delete categoryRules[category];
    } else {
      categoryRules[category] = safeRule;
    }
    if (Object.keys(categoryRules).length === 0) {
      delete siteCategoryRules[normalizedHostname];
    } else {
      siteCategoryRules[normalizedHostname] = categoryRules;
    }
    return { ...state, siteCategoryRules };
  });
}

export async function upsertPersonalRule(ruleInput: unknown): Promise<ExtensionState> {
  const candidate = parsePersonalRule(ruleInput, "personalRule", false);
  if (candidate.enabled && candidate.sensitiveEnabled && !(await readRiskGrant(candidate.scope.hostname))) {
    throw new Error("启用敏感个性化规则前，必须先为该站点完成高风险授权。");
  }
  return updateState((state) => {
    const existing = state.personalRules.find((rule) => rule.id === candidate.id);
    const now = Date.now();
    const nextRule: PersonalRule = {
      ...candidate,
      createdAt: existing?.createdAt ?? candidate.createdAt ?? now,
      updatedAt: now,
    };
    const personalRules = state.personalRules.filter((rule) => rule.id !== nextRule.id);
    personalRules.push(nextRule);
    return { ...state, personalRules: normalizeRuleOrder(personalRules) };
  });
}

export async function removePersonalRule(ruleId: string): Promise<ExtensionState> {
  return updateState((state) => ({
    ...state,
    personalRules: normalizeRuleOrder(state.personalRules.filter((rule) => rule.id !== ruleId)),
  }));
}

export async function reorderPersonalRules(orderedIds: string[]): Promise<ExtensionState> {
  const uniqueIds = [...new Set(orderedIds)];
  if (uniqueIds.length !== orderedIds.length) {
    throw new Error("个性化规则排序不能包含重复 ID。");
  }
  return updateState((state) => {
    const selected = uniqueIds.map((id) => state.personalRules.find((rule) => rule.id === id));
    if (selected.some((rule) => !rule)) {
      throw new Error("个性化规则排序包含不存在的规则。");
    }
    const scopeKey = selected.length > 0 ? getRuleScopeKey(selected[0]!) : "";
    if (selected.some((rule) => getRuleScopeKey(rule!) !== scopeKey)) {
      throw new Error("只能对同一站点或页面作用域内的规则排序。");
    }
    const scopeRules = state.personalRules.filter((rule) => getRuleScopeKey(rule) === scopeKey);
    if (scopeRules.length !== selected.length) {
      throw new Error("排序必须包含该作用域内的全部规则。");
    }
    const orderById = new Map(uniqueIds.map((id, index) => [id, index]));
    return {
      ...state,
      personalRules: state.personalRules.map((rule) =>
        orderById.has(rule.id) ? { ...rule, order: orderById.get(rule.id)!, updatedAt: Date.now() } : rule,
      ),
    };
  });
}

export async function swapPersonalRules(firstId: string, secondId: string): Promise<ExtensionState> {
  return updateState((state) => {
    const first = state.personalRules.find((rule) => rule.id === firstId);
    const second = state.personalRules.find((rule) => rule.id === secondId);
    if (!first || !second) throw new Error("要交换的个性化规则不存在。");
    if (getRuleScopeKey(first) !== getRuleScopeKey(second)) throw new Error("只能交换同一作用域内的规则。");
    return {
      ...state,
      personalRules: state.personalRules.map((rule) => {
        if (rule.id === firstId) return { ...rule, order: second.order, updatedAt: Date.now() };
        if (rule.id === secondId) return { ...rule, order: first.order, updatedAt: Date.now() };
        return rule;
      }),
    };
  });
}

export async function readRiskGrant(hostname: string): Promise<RiskGrant | undefined> {
  const normalizedHostname = normalizeHostname(hostname);
  const stored = await chrome.storage.local.get(RISK_GRANTS_KEY);
  return sanitizeRiskGrants(stored[RISK_GRANTS_KEY])[normalizedHostname];
}

export async function listRiskGrants(): Promise<RiskGrant[]> {
  return Object.values(await readRiskGrants()).sort((left, right) => left.hostname.localeCompare(right.hostname));
}

export async function grantRisk(hostname: string): Promise<RiskGrant> {
  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname) {
    throw new Error("高风险授权必须绑定有效的 hostname。");
  }
  const grants = await readRiskGrants();
  const grant: RiskGrant = {
    hostname: normalizedHostname,
    grantedAt: Date.now(),
    confirmationVersion: 1,
  };
  await chrome.storage.local.set({ [RISK_GRANTS_KEY]: { ...grants, [normalizedHostname]: grant } });
  return grant;
}

export async function revokeRisk(hostname: string): Promise<void> {
  const normalizedHostname = normalizeHostname(hostname);
  const grants = await readRiskGrants();
  delete grants[normalizedHostname];
  await chrome.storage.local.set({ [RISK_GRANTS_KEY]: grants });
  await updateState((state) => ({
    ...state,
    personalRules: state.personalRules.map((rule) =>
      rule.scope.hostname === normalizedHostname && rule.sensitiveEnabled
        ? { ...rule, enabled: false, sensitiveEnabled: false, updatedAt: Date.now() }
        : rule,
    ),
  }));
}

export async function hasSiteAuthorizationRecord(hostname: string): Promise<boolean> {
  return (await readAuthorizedSites()).includes(normalizeHostname(hostname));
}

export async function markSiteAuthorized(hostname: string): Promise<void> {
  const sites = new Set(await readAuthorizedSites());
  sites.add(normalizeHostname(hostname));
  await writeAuthorizedSites([...sites]);
}

export async function removeSiteAuthorizationRecord(hostname: string): Promise<void> {
  await removeSiteAuthorizationRecords([hostname]);
}

export async function removeSiteAuthorizationRecords(hostnames: string[]): Promise<void> {
  const sites = new Set(await readAuthorizedSites());
  hostnames.forEach((hostname) => sites.delete(normalizeHostname(hostname)));
  await writeAuthorizedSites([...sites]);
}

export async function clearSiteAuthorizationRecords(): Promise<void> {
  await chrome.storage.local.set({ [AUTHORIZED_SITES_KEY]: [] });
}

async function initializeState(): Promise<ExtensionState> {
  const local = await chrome.storage.local.get([...STATE_KEYS]);
  if (local.schemaVersion === 4) {
    const state = normalizePersistedState(local);
    await writeState(state);
    return state;
  }

  // v4 首次启动只读取旧 Sync 配置，不删除也不再向 Sync 写入。
  const legacy = await chrome.storage.sync.get([...LEGACY_SYNC_KEYS]);
  const state = hasValidLegacyState(legacy)
    ? migrateLegacyState(legacy, false)
    : createDefaultState();
  await writeState(state);
  return state;
}

async function writeState(state: ExtensionState): Promise<void> {
  await chrome.storage.local.set(state);
  await chrome.storage.local.remove(OBSOLETE_LOCAL_KEYS);
}

async function updateState(updater: (state: ExtensionState) => ExtensionState): Promise<ExtensionState> {
  const task = updateQueue.then(async () => {
    const state = await readState();
    const nextState = normalizePersistedState(updater(state) as unknown as Record<string, unknown>);
    await writeState(nextState);
    return nextState;
  });
  updateQueue = task.catch(() => undefined);
  return task;
}

function normalizePersistedState(value: Record<string, unknown>): ExtensionState {
  return parseV4State(value, false);
}

function parseV4State(
  value: Record<string, unknown>,
  quarantineSensitive: boolean,
  strictPersonalRules = false,
): ExtensionState {
  const presetId = parsePresetId(value.presetId, "presetId", DEFAULT_PRESET_ID);
  return {
    schemaVersion: 4,
    presetId,
    globalCategoryRules: sanitizeGlobalCategoryRules(value.globalCategoryRules, presetId),
    siteCategoryRules: sanitizeSiteCategoryRules(value.siteCategoryRules),
    siteRules: sanitizeRuleMap(value.siteRules, "site"),
    pageRules: sanitizeRuleMap(value.pageRules, "page"),
    personalRules: sanitizePersonalRules(value.personalRules, quarantineSensitive, strictPersonalRules),
    disabledSites: sanitizeHostnameList(value.disabledSites),
  };
}

function migrateLegacyState(value: Record<string, unknown>, quarantineSensitive: boolean): ExtensionState {
  const scope = parseLegacyScope(value.takeoverScopeLevel);
  const presetId = PRESET_BY_LEGACY_SCOPE[scope];
  const legacyGlobal = readLegacyRuleMap(value.globalCategoryRules);
  const globalCategoryRules = migrateLegacyCategoryRules(legacyGlobal, scope);
  const siteCategoryRules = migrateLegacySiteCategoryRules(value.siteCategoryRules, scope);
  const legacySiteRules = sanitizeLegacyOverallRules(value.siteRules, "site");
  const legacyPageRules = sanitizeLegacyOverallRules(value.pageRules, "page");
  const personalRules = [
    ...Object.entries(legacyPageRules).map(([pageKey, action], index) =>
      createLegacyOverallPersonalRule("page", pageKey, action, scope, index),
    ),
    ...Object.entries(legacySiteRules).map(([hostname, action], index) =>
      createLegacyOverallPersonalRule("site", hostname, action, scope, index),
    ),
  ];
  return {
    schemaVersion: 4,
    presetId: isSameCategoryRules(globalCategoryRules, createPresetCategoryRules(presetId)) ? presetId : "custom",
    globalCategoryRules,
    siteCategoryRules,
    // 旧整体规则转为受原范围约束的个性化规则，避免升级后意外扩大接管面。
    siteRules: {},
    pageRules: {},
    personalRules: quarantineSensitive
      ? personalRules.map((rule) => ({ ...rule, enabled: rule.sensitiveEnabled ? false : rule.enabled }))
      : personalRules,
    disabledSites: sanitizeHostnameList(value.disabledSites),
  };
}

function migrateLegacyCategoryRules(
  legacyRules: Record<LegacyCategory, NavigationDisposition>,
  scope: LegacyScopeLevel,
): CategoryRuleMap {
  return NAVIGATION_CATEGORY_ORDER.reduce<CategoryRuleMap>((result, category) => {
    const legacyCategory = LEGACY_CATEGORY_MAP[category];
    result[category] =
      isProtectedCategory(category) || LEGACY_MINIMUM_SCOPE[legacyCategory] > scope
        ? "preserve-native"
        : legacyRules[legacyCategory];
    return result;
  }, createDefaultGlobalCategoryRules());
}

function migrateLegacySiteCategoryRules(
  value: unknown,
  scope: LegacyScopeLevel,
): Record<string, SiteCategoryRuleMap> {
  if (!isRecord(value)) return {};
  const result: Record<string, SiteCategoryRuleMap> = {};
  for (const [rawHostname, rawRules] of Object.entries(value)) {
    if (!isRecord(rawRules)) continue;
    const hostname = normalizeHostname(rawHostname);
    const rules: SiteCategoryRuleMap = {};
    for (const category of NAVIGATION_CATEGORY_ORDER) {
      const legacyCategory = LEGACY_CATEGORY_MAP[category];
      const entry = rawRules[legacyCategory];
      if (
        !isProtectedCategory(category) &&
        LEGACY_MINIMUM_SCOPE[legacyCategory] <= scope &&
        isNavigationDisposition(entry)
      ) {
        rules[category] = entry;
      }
    }
    if (hostname && Object.keys(rules).length > 0) result[hostname] = rules;
  }
  return result;
}

function createLegacyOverallPersonalRule(
  scopeType: "site" | "page",
  key: string,
  action: NavigationDisposition,
  scope: LegacyScopeLevel,
  order: number,
): PersonalRule {
  const pageKey = scopeType === "page" ? normalizePageUrl(key) : undefined;
  const hostname = scopeType === "page" ? getHostname(pageKey!) : normalizeHostname(key);
  const timestamp = 0;
  return {
    id: `legacy-${scopeType}-${stableId(key)}`,
    name: "从 0.5.1 整体规则迁移",
    enabled: true,
    scope: scopeType === "page" ? { type: "page", pageKey: pageKey!, hostname } : { type: "site", hostname },
    order,
    action,
    match: createLegacyScopeMatch(scope),
    sensitiveEnabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createLegacyScopeMatch(scope: LegacyScopeLevel): PersonalRuleMatch {
  if (scope === 0) {
    return { triggers: ["anchor"], relations: ["same-origin"], semantics: ["content", "list-detail", "document", "media", "spa-route"] };
  }
  if (scope === 1) {
    return { triggers: ["anchor"], semantics: ["content", "site-root", "primary-navigation", "breadcrumb-tab", "list-detail", "document", "media", "spa-route"] };
  }
  if (scope === 2) return { triggers: ["anchor"] };
  if (scope === 3) return { triggers: ["anchor", "form"] };
  return {};
}

function readLegacyRuleMap(value: unknown): Record<LegacyCategory, NavigationDisposition> {
  if (!isRecord(value)) return { ...LEGACY_DEFAULT_RULES };
  return (Object.keys(LEGACY_DEFAULT_RULES) as LegacyCategory[]).reduce((rules, category) => {
    const entry = value[category];
    rules[category] = isNavigationDisposition(entry) ? entry : LEGACY_DEFAULT_RULES[category];
    return rules;
  }, { ...LEGACY_DEFAULT_RULES });
}

function sanitizeGlobalCategoryRules(value: unknown, presetId: BasicPresetId): CategoryRuleMap {
  const defaults = presetId === "custom" ? createDefaultGlobalCategoryRules() : createPresetCategoryRules(presetId);
  if (!isRecord(value)) return defaults;
  return NAVIGATION_CATEGORY_ORDER.reduce<CategoryRuleMap>((result, category) => {
    result[category] = isProtectedCategory(category)
      ? "preserve-native"
      : isBasicCategoryRule(value[category])
        ? value[category]
        : defaults[category];
    return result;
  }, { ...defaults });
}

function sanitizeSiteCategoryRules(value: unknown): Record<string, SiteCategoryRuleMap> {
  if (!isRecord(value)) return {};
  const result: Record<string, SiteCategoryRuleMap> = {};
  for (const [rawHostname, rawRules] of Object.entries(value)) {
    if (!isRecord(rawRules)) continue;
    const hostname = normalizeHostname(rawHostname);
    const rules: SiteCategoryRuleMap = {};
    for (const category of NAVIGATION_CATEGORY_ORDER) {
      const entry = rawRules[category];
      if (!isProtectedCategory(category) && isNavigationDisposition(entry)) rules[category] = entry;
    }
    if (hostname && Object.keys(rules).length > 0) result[hostname] = rules;
  }
  return result;
}

function sanitizeRuleMap(value: unknown, kind: "site" | "page"): Record<string, NavigationDisposition> {
  if (!isRecord(value)) return {};
  const result: Record<string, NavigationDisposition> = {};
  for (const [rawKey, entry] of Object.entries(value)) {
    if (!isNavigationDisposition(entry)) continue;
    try {
      const key = kind === "page" ? normalizePageUrl(rawKey) : normalizeHostname(rawKey);
      if (key) result[key] = entry;
    } catch {
      // 无效页面键不进入运行时状态。
    }
  }
  return result;
}

function sanitizeLegacyOverallRules(value: unknown, kind: "site" | "page"): Record<string, NavigationDisposition> {
  return sanitizeRuleMap(value, kind);
}

function sanitizePersonalRules(
  value: unknown,
  quarantineSensitive: boolean,
  strict = false,
): PersonalRule[] {
  if (!Array.isArray(value)) {
    if (strict) throw new Error("personalRules 必须是数组。");
    return [];
  }
  const seen = new Set<string>();
  const rules: PersonalRule[] = [];
  value.forEach((entry, index) => {
    try {
      const rule = parsePersonalRule(entry, `personalRules.${index}`, quarantineSensitive);
      if (seen.has(rule.id)) {
        if (strict) throw new Error(`personalRules.${index}.id 与其他规则重复。`);
      } else {
        seen.add(rule.id);
        rules.push(rule);
      }
    } catch (error) {
      if (strict) throw error;
      // 持久化数据中的单条损坏规则不会阻断整个扩展启动。
    }
  });
  return normalizeRuleOrder(rules);
}

function parsePersonalRule(value: unknown, fieldName: string, quarantineSensitive: boolean): PersonalRule {
  const record = requireRecord(value, `${fieldName} 必须是对象。`);
  const id = requireNonEmptyString(record.id, `${fieldName}.id`);
  const name = requireNonEmptyString(record.name, `${fieldName}.name`);
  const scopeRecord = requireRecord(record.scope, `${fieldName}.scope 必须是对象。`);
  const scopeType = scopeRecord.type;
  if (scopeType !== "site" && scopeType !== "page") throw new Error(`${fieldName}.scope.type 无效。`);
  const hostname = normalizeHostname(requireNonEmptyString(scopeRecord.hostname, `${fieldName}.scope.hostname`));
  const scope = scopeType === "page"
    ? { type: "page" as const, pageKey: normalizePageUrl(requireNonEmptyString(scopeRecord.pageKey, `${fieldName}.scope.pageKey`)), hostname }
    : { type: "site" as const, hostname };
  if (scope.type === "page" && getHostname(scope.pageKey) !== hostname) {
    throw new Error(`${fieldName}.scope.pageKey 与 hostname 不一致。`);
  }
  const sensitiveEnabled = record.sensitiveEnabled === true;
  return {
    id,
    name,
    enabled: quarantineSensitive && sensitiveEnabled ? false : record.enabled !== false,
    scope,
    order: isNonNegativeInteger(record.order) ? record.order : 0,
    action: parseNavigationDisposition(record.action, `${fieldName}.action`),
    match: parsePersonalRuleMatch(record.match, `${fieldName}.match`),
    sensitiveEnabled,
    createdAt: typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : 0,
    updatedAt: typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
  };
}

function parsePersonalRuleMatch(value: unknown, fieldName: string): PersonalRuleMatch {
  if (value === undefined) return {};
  const record = requireRecord(value, `${fieldName} 必须是对象。`);
  const result: PersonalRuleMatch = {};
  if (record.sourceUrl !== undefined) result.sourceUrl = parseUrlMatcher(record.sourceUrl, `${fieldName}.sourceUrl`);
  if (record.targetUrl !== undefined) result.targetUrl = parseUrlMatcher(record.targetUrl, `${fieldName}.targetUrl`);
  result.relations = parseEnumArray(record.relations, ["same-document", "same-origin", "same-site", "cross-site"], `${fieldName}.relations`);
  result.triggers = parseEnumArray(record.triggers, ["anchor", "form", "window.open"], `${fieldName}.triggers`);
  result.semantics = parseEnumArray(record.semantics, ["content", "site-root", "primary-navigation", "breadcrumb-tab", "list-detail", "pagination", "content-sequence", "search-filter", "image-gallery", "document", "media", "spa-route", "auth-account", "payment-checkout", "popup", "unknown"], `${fieldName}.semantics`);
  result.nativeTargets = parseEnumArray(record.nativeTargets, ["self", "blank", "named", "parent", "top", "unfenced-top"], `${fieldName}.nativeTargets`);
  result.frameContexts = parseEnumArray(record.frameContexts, ["top", "same-origin-frame", "cross-origin-frame"], `${fieldName}.frameContexts`);
  if (record.formMethods !== undefined) {
    if (!Array.isArray(record.formMethods) || !record.formMethods.every((item) => typeof item === "string")) throw new Error(`${fieldName}.formMethods 必须是字符串数组。`);
    result.formMethods = [...new Set(record.formMethods.map((item) => item.trim().toUpperCase()).filter(Boolean))];
  }
  if (record.element !== undefined) {
    const element = requireRecord(record.element, `${fieldName}.element 必须是对象。`);
    const parsedElement: NonNullable<PersonalRuleMatch["element"]> = {};
    if (element.selector !== undefined) {
      parsedElement.selector = requireNonEmptyString(element.selector, `${fieldName}.element.selector`);
      validateRestrictedCssSelector(parsedElement.selector, `${fieldName}.element.selector`);
    }
    if (element.tag !== undefined) parsedElement.tag = requireNonEmptyString(element.tag, `${fieldName}.element.tag`).toLowerCase();
    if (element.attributes !== undefined) {
      const attributes = requireRecord(element.attributes, `${fieldName}.element.attributes 必须是对象。`);
      parsedElement.attributes = Object.fromEntries(Object.entries(attributes).map(([key, entry]) => [key.toLowerCase(), requireString(entry, `${fieldName}.element.attributes.${key}`)]));
    }
    result.element = parsedElement;
  }
  return removeUndefinedFields(result);
}

function parseUrlMatcher(value: unknown, fieldName: string): UrlMatcher {
  const record = requireRecord(value, `${fieldName} 必须是对象。`);
  if (record.kind !== "exact" && record.kind !== "prefix" && record.kind !== "glob" && record.kind !== "regex") throw new Error(`${fieldName}.kind 无效。`);
  const matcher: UrlMatcher = {
    kind: record.kind,
    value: requireNonEmptyString(record.value, `${fieldName}.value`),
  };
  validateUrlMatcher(matcher, fieldName);
  return matcher;
}

function parseEnumArray<T extends string>(value: unknown, allowed: readonly T[], fieldName: string): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => allowed.includes(item as T))) throw new Error(`${fieldName} 包含无效值。`);
  return [...new Set(value as T[])];
}

function normalizeRuleOrder(rules: PersonalRule[]): PersonalRule[] {
  const groups = new Map<string, PersonalRule[]>();
  rules.forEach((rule) => {
    const key = getRuleScopeKey(rule);
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  });
  const normalized: PersonalRule[] = [];
  for (const group of groups.values()) {
    group.sort((left, right) => left.order - right.order || left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    normalized.push(...group.map((rule, order) => ({ ...rule, order })));
  }
  return normalized;
}

function getRuleScopeKey(rule: PersonalRule): string {
  return rule.scope.type === "page" ? `page:${rule.scope.pageKey}` : `site:${rule.scope.hostname}`;
}

function parsePresetId(value: unknown, fieldName: string, fallback?: BasicPresetId): BasicPresetId {
  if (value === "precise" || value === "content" || value === "broad" || value === "deep" || value === "widest" || value === "custom") return value;
  if (fallback) return fallback;
  throw new Error(`${fieldName} 不是有效预设。`);
}

function hasValidLegacyState(value: Record<string, unknown>): boolean {
  const schemaVersion = value.schemaVersion;
  return (
    (typeof schemaVersion === "number" && Number.isInteger(schemaVersion) && schemaVersion >= 1 && schemaVersion < 4) ||
    value.takeoverScopeLevel === 0 ||
    value.takeoverScopeLevel === 1 ||
    value.takeoverScopeLevel === 2 ||
    value.takeoverScopeLevel === 3 ||
    value.takeoverScopeLevel === 4 ||
    value.globalMode === "same-tab" ||
    value.globalMode === "new-tab" ||
    isRecord(value.globalCategoryRules) ||
    isRecord(value.siteCategoryRules) ||
    isRecord(value.siteRules) ||
    isRecord(value.pageRules) ||
    (Array.isArray(value.disabledSites) && value.disabledSites.every((entry) => typeof entry === "string"))
  );
}

function parseLegacyScope(value: unknown): LegacyScopeLevel {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 ? value : 4;
}

function parseNavigationDisposition(value: unknown, fieldName: string): NavigationDisposition {
  if (isNavigationDisposition(value)) return value;
  throw new Error(`${fieldName} 只能是 same-tab、new-tab 或 preserve-native。`);
}

function isNavigationDisposition(value: unknown): value is NavigationDisposition {
  return value === "same-tab" || value === "new-tab" || value === "preserve-native";
}

function isBasicCategoryRule(value: unknown): value is BasicCategoryRule {
  return value === "inherit" || isNavigationDisposition(value);
}

function isProtectedCategory(category: NavigationCategory): boolean {
  return isSensitiveCategory(category) || isHardNativeCategory(category);
}

function writeRuleMapEntry<T extends string>(ruleMap: Record<string, T>, key: string, mode: T | "inherit"): Record<string, T> {
  const next = { ...ruleMap };
  mode === "inherit" ? delete next[key] : (next[key] = mode);
  return next;
}

async function readAuthorizedSites(): Promise<string[]> {
  const stored = await chrome.storage.local.get(AUTHORIZED_SITES_KEY);
  return sanitizeHostnameList(stored[AUTHORIZED_SITES_KEY]);
}

async function writeAuthorizedSites(hostnames: string[]): Promise<void> {
  await chrome.storage.local.set({ [AUTHORIZED_SITES_KEY]: sanitizeHostnameList(hostnames) });
}

async function readRiskGrants(): Promise<Record<string, RiskGrant>> {
  const stored = await chrome.storage.local.get(RISK_GRANTS_KEY);
  return sanitizeRiskGrants(stored[RISK_GRANTS_KEY]);
}

function sanitizeRiskGrants(value: unknown): Record<string, RiskGrant> {
  if (!isRecord(value)) return {};
  const result: Record<string, RiskGrant> = {};
  for (const entry of Object.values(value)) {
    if (!isRecord(entry) || entry.confirmationVersion !== 1 || typeof entry.grantedAt !== "number" || typeof entry.hostname !== "string") continue;
    const hostname = normalizeHostname(entry.hostname);
    if (hostname) result[hostname] = { hostname, grantedAt: entry.grantedAt, confirmationVersion: 1 };
  }
  return result;
}

function sanitizeHostnameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string").map(normalizeHostname).filter(Boolean))].sort();
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!normalized || normalized.includes("/") || normalized.includes(":") || parseUrl(`https://${normalized}/`)?.hostname !== normalized) return "";
  return normalized;
}

function cloneState(state: ExtensionState): ExtensionState {
  return structuredClone(state);
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

function isSameCategoryRules(left: CategoryRuleMap, right: CategoryRuleMap): boolean {
  return NAVIGATION_CATEGORY_ORDER.every((category) => left[category] === right[category]);
}

function parseBackupEnvelope(record: Record<string, unknown>): Record<string, unknown> | null {
  const backupKeys = ["formatVersion", "extensionVersion", "exportedAt", "state"];
  if (!backupKeys.some((key) => key in record)) return null;
  if (record.formatVersion === undefined) throw new Error("备份缺少 formatVersion。");
  if (record.formatVersion !== 1) throw new Error("不支持该备份 formatVersion。");
  requireNonEmptyString(record.extensionVersion, "extensionVersion");
  validateExportedAt(record.exportedAt);
  if (!isRecord(record.state)) throw new Error("备份缺少有效的 state 字段。");
  return record.state;
}

function validateExportedAt(value: unknown): void {
  if (typeof value !== "string") throw new Error("exportedAt 必须是有效时间字符串。");
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw new Error("exportedAt 必须是有效的 ISO 时间。");
  }
}

function parseImportedSchemaVersion(value: unknown, required: boolean): number | undefined {
  if (value === undefined) {
    if (required) throw new Error("备份 state 缺少 schemaVersion。");
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("schemaVersion 必须是大于等于 1 的整数。");
  }
  return value;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  const result = requireString(value, fieldName).trim();
  if (!result) throw new Error(`${fieldName} 不能为空。`);
  return result;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") throw new Error(`${fieldName} 必须是字符串。`);
  return value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function removeUndefinedFields<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
