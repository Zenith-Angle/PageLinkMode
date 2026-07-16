import test from "node:test";
import assert from "node:assert/strict";

import type { ExtensionState, PersonalRule } from "./types";
import {
  createConfigurationBackup,
  createDefaultState,
  ensureState,
  grantRisk,
  parseImportedState,
  readState,
  replaceState,
  revokeRisk,
  upsertPersonalRule,
} from "./storage";

test("新安装使用 schema v4 和适中预设", () => {
  const state = createDefaultState();
  assert.equal(state.schemaVersion, 4);
  assert.equal(state.presetId, "broad");
  assert.equal(state.globalCategoryRules["link-list-detail"], "new-tab");
  assert.equal(state.globalCategoryRules["link-pagination"], "preserve-native");
  assert.deepEqual(state.personalRules, []);
  assert.equal("globalMode" in state, false);
});

test("空 local 和空 Sync 的真正新安装直接写入适中默认状态", async () => {
  const localData: Record<string, unknown> = {};
  const syncData: Record<string, unknown> = {};
  let syncReads = 0;
  installChromeStorageMock(localData, syncData, () => syncReads++);

  const state = await ensureState();

  assert.deepEqual(state, createDefaultState());
  assert.equal(localData.presetId, "broad");
  assert.equal(
    (localData.globalCategoryRules as ExtensionState["globalCategoryRules"])["open-same-origin"],
    "preserve-native",
  );
  assert.equal(syncReads, 1);
});

test("旧版默认内容规则在读取时识别为新的适中档且不改写分类值", async () => {
  const previousContentRules = {
    ...createDefaultState().globalCategoryRules,
    "link-search-filter": "preserve-native" as const,
    "link-image-gallery": "preserve-native" as const,
    "link-spa-route": "preserve-native" as const,
    "form-search-get": "preserve-native" as const,
    "form-general-get": "preserve-native" as const,
  };
  const localData: Record<string, unknown> = {
    ...createDefaultState(),
    presetId: "content",
    globalCategoryRules: previousContentRules,
  };
  installChromeStorageMock(localData, {});

  const state = await readState();

  assert.equal(state.presetId, "broad");
  assert.deepEqual(state.globalCategoryRules, previousContentRules);
});

test("Sync 中存在有效旧键时仍执行旧配置迁移", async () => {
  const localData: Record<string, unknown> = {};
  const syncData: Record<string, unknown> = { globalMode: "new-tab" };
  installChromeStorageMock(localData, syncData);

  const state = await ensureState();

  assert.equal(state.schemaVersion, 4);
  assert.equal(state.presetId, "custom");
  assert.equal(state.globalCategoryRules["open-same-origin"], "new-tab");
});

test("旧 v3 的 12 类与范围会实体化为 v4 分类值", () => {
  const state = parseImportedState({
    schemaVersion: 3,
    takeoverScopeLevel: 1,
    globalMode: "new-tab",
    globalCategoryRules: {
      "same-origin-content-link": "same-tab",
      "cross-origin-content-link": "new-tab",
      "site-shell-navigation": "same-tab",
      "pagination-navigation": "new-tab",
      "image-viewer-link": "new-tab",
      "auth-link": "new-tab",
      "get-form-submit": "new-tab",
      "non-get-form-submit": "new-tab",
      "window-open": "new-tab",
      "auth-window-open": "new-tab",
      "image-window-open": "new-tab",
      "named-or-popup-window-open": "new-tab",
    },
    siteRules: {},
    pageRules: {},
    disabledSites: [],
  });

  assert.equal(state.schemaVersion, 4);
  assert.equal(state.globalCategoryRules["link-same-origin"], "same-tab");
  assert.equal(state.globalCategoryRules["link-cross-site"], "new-tab");
  assert.equal(state.globalCategoryRules["link-primary-navigation"], "same-tab");
  assert.equal(state.globalCategoryRules["link-pagination"], "preserve-native");
  assert.equal(state.globalCategoryRules["form-general-get"], "preserve-native");
  assert.equal(state.globalCategoryRules["open-cross-site"], "preserve-native");
  assert.equal(state.globalCategoryRules["link-auth-account"], "preserve-native");
});

test("旧整体规则迁移为受原范围约束的个性化规则", () => {
  const state = parseImportedState({
    takeoverScopeLevel: 0,
    globalMode: "new-tab",
    siteRules: { "EXAMPLE.COM": "same-tab" },
    pageRules: { "https://example.com/list?q=1#part": "new-tab" },
  });

  assert.deepEqual(state.siteRules, {});
  assert.deepEqual(state.pageRules, {});
  assert.equal(state.personalRules.length, 2);
  const siteRule = state.personalRules.find((rule) => rule.scope.type === "site")!;
  const pageRule = state.personalRules.find((rule) => rule.scope.type === "page")!;
  assert.equal(siteRule.scope.hostname, "example.com");
  assert.deepEqual(siteRule.match.triggers, ["anchor"]);
  assert.deepEqual(siteRule.match.relations, ["same-origin"]);
  assert.equal(pageRule.scope.type, "page");
  if (pageRule.scope.type === "page") assert.equal(pageRule.scope.pageKey, "https://example.com/list?q=1");
});

test("v4 站点和页面整体规则支持保持原生", () => {
  const state = parseImportedState({
    ...createDefaultState(),
    siteRules: { "EXAMPLE.COM": "preserve-native" },
    pageRules: { "https://example.com/path#section": "preserve-native" },
  });
  assert.equal(state.siteRules["example.com"], "preserve-native");
  assert.equal(state.pageRules["https://example.com/path"], "preserve-native");
});

test("导入备份时敏感规则会被隔离为禁用且风险授权不属于备份", () => {
  const sensitiveRule = makePersonalRule({
    id: "sensitive-1",
    sensitiveEnabled: true,
    enabled: true,
    match: { semantics: ["payment-checkout"] },
  });
  const backup = createConfigurationBackup(
    { ...createDefaultState(), personalRules: [sensitiveRule] },
    "0.6.1",
    new Date("2026-07-14T00:00:00.000Z"),
  );
  const imported = parseImportedState({
    ...backup,
    riskGrants: { "example.com": { hostname: "example.com", grantedAt: 1, confirmationVersion: 1 } },
    state: {
      ...backup.state,
      riskGrants: { "example.com": { hostname: "example.com", grantedAt: 1, confirmationVersion: 1 } },
    },
  });

  assert.equal(backup.formatVersion, 1);
  assert.equal(backup.extensionVersion, "0.6.1");
  assert.equal(imported.personalRules[0].enabled, false);
  assert.equal(imported.personalRules[0].sensitiveEnabled, true);
  assert.equal("riskGrants" in backup.state, false);
  assert.equal("riskGrants" in imported, false);
});

test("导入备份时完整校验格式版本、扩展版本、导出时间和 state schema", () => {
  const state = createDefaultState();
  const validMetadata = {
    formatVersion: 1,
    extensionVersion: "0.5.1",
    exportedAt: "2026-07-14T00:00:00.000Z",
  };

  assert.throws(
    () => parseImportedState({ extensionVersion: "0.5.1", exportedAt: validMetadata.exportedAt, state }),
    /formatVersion/,
  );
  assert.throws(
    () => parseImportedState({ ...validMetadata, formatVersion: 99, state }),
    /formatVersion/,
  );
  assert.throws(
    () => parseImportedState({ ...validMetadata, extensionVersion: " ", state }),
    /extensionVersion.*不能为空/,
  );
  assert.throws(
    () => parseImportedState({ ...validMetadata, exportedAt: "明天", state }),
    /exportedAt.*时间/,
  );
  assert.throws(
    () => parseImportedState({ ...validMetadata, state: { ...state, schemaVersion: undefined } }),
    /schemaVersion/,
  );
});

test("导入备份时坏规则必须报告具体字段，不能静默丢弃", () => {
  const metadata = {
    formatVersion: 1,
    extensionVersion: "0.5.1",
    exportedAt: "2026-07-14T00:00:00.000Z",
  };
  const invalidRegexRule = makePersonalRule({
    match: { sourceUrl: { kind: "regex", value: "(account)\\1" } },
  });
  const invalidSelectorRule = makePersonalRule({
    id: "invalid-selector",
    match: { element: { selector: "main a:first-child" } },
  });

  assert.throws(
    () => parseImportedState({ ...metadata, state: { ...createDefaultState(), personalRules: [invalidRegexRule] } }),
    /personalRules\.0\.match\.sourceUrl.*RE2.*不支持/,
  );
  assert.throws(
    () => parseImportedState({ ...metadata, state: { ...createDefaultState(), personalRules: [invalidSelectorRule] } }),
    /personalRules\.0\.match\.element\.selector.*超出允许范围/,
  );
});

test("旧 state 直导以 schemaVersion 为准，不被混入的 v4 字段改变迁移路径", () => {
  const imported = parseImportedState({
    schemaVersion: 3,
    takeoverScopeLevel: 0,
    presetId: "widest",
    globalMode: "new-tab",
    siteRules: {},
    pageRules: {},
  });

  assert.notEqual(imported.presetId, "widest");
  assert.equal(imported.globalCategoryRules["open-cross-site"], "preserve-native");
});

test("保存个性化规则时拒绝 RE2 不支持的 URL 正则", async () => {
  const localData: Record<string, unknown> = { ...createDefaultState() };
  installChromeStorageMock(localData, {});

  const rule = makePersonalRule({
    match: { targetUrl: { kind: "regex", value: "https://example\\.com/(?!logout)" } },
  });

  await assert.rejects(() => upsertPersonalRule(rule), /targetUrl.*RE2.*不支持/);
  assert.deepEqual(localData.personalRules, []);
});

test("保存个性化规则时拒绝超出范围的 CSS selector", async () => {
  const localData: Record<string, unknown> = { ...createDefaultState() };
  installChromeStorageMock(localData, {});

  for (const selector of ["main > a", "a:not(.logout)", "a[href^='javascript:']"]) {
    const rule = makePersonalRule({
      id: `selector-${selector}`,
      match: { element: { selector } },
    });
    await assert.rejects(() => upsertPersonalRule(rule), /selector.*超出允许范围/);
  }
  await assert.rejects(
    () => upsertPersonalRule(makePersonalRule({ match: { element: { selector: `a.${"x".repeat(512)}` } } })),
    /selector.*不能超过/,
  );

  assert.deepEqual(localData.personalRules, []);
});

test("撤销站点风险授权会同时关闭并停用该站点的敏感规则", async () => {
  const sensitiveRule = makePersonalRule({
    id: "sensitive-example",
    enabled: true,
    sensitiveEnabled: true,
  });
  const normalRule = makePersonalRule({
    id: "normal-example",
    enabled: true,
    sensitiveEnabled: false,
  });
  const otherSiteRule = makePersonalRule({
    id: "sensitive-other",
    enabled: true,
    sensitiveEnabled: true,
    scope: { type: "site", hostname: "other.example" },
  });
  const localData: Record<string, unknown> = {
    ...createDefaultState(),
    personalRules: [sensitiveRule, normalRule, otherSiteRule],
    riskGrants: {
      "example.com": { hostname: "example.com", grantedAt: 1, confirmationVersion: 1 },
    },
  };
  installChromeStorageMock(localData, {});

  await revokeRisk("EXAMPLE.COM");

  const state = await readState();
  const revokedRule = state.personalRules.find((rule) => rule.id === sensitiveRule.id);
  const preservedNormalRule = state.personalRules.find((rule) => rule.id === normalRule.id);
  const preservedOtherSiteRule = state.personalRules.find((rule) => rule.id === otherSiteRule.id);
  assert.equal(revokedRule?.enabled, false);
  assert.equal(revokedRule?.sensitiveEnabled, false);
  assert.equal(preservedNormalRule?.enabled, true);
  assert.equal(preservedNormalRule?.sensitiveEnabled, false);
  assert.equal(preservedOtherSiteRule?.enabled, true);
  assert.equal(preservedOtherSiteRule?.sensitiveEnabled, true);
  assert.deepEqual(localData.riskGrants, {});
});

test("高风险授权拒绝空值和非 hostname 输入", async () => {
  const localData: Record<string, unknown> = {
    ...createDefaultState(),
    riskGrants: {},
  };
  installChromeStorageMock(localData, {});

  for (const hostname of ["", "https://example.com/path", "example.com:443"]) {
    await assert.rejects(() => grantRisk(hostname), /有效的 hostname/);
  }

  assert.deepEqual(localData.riskGrants, {});
});

test("首次没有 local v4 时只读一次旧 Sync，之后只从 local 读取", async () => {
  const localData: Record<string, unknown> = {};
  const syncData: Record<string, unknown> = {
    schemaVersion: 3,
    takeoverScopeLevel: 4,
    globalMode: "new-tab",
    siteRules: {},
    pageRules: {},
  };
  let syncReads = 0;
  installChromeStorageMock(localData, syncData, () => syncReads++);

  const migrated = await ensureState();
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(localData.schemaVersion, 4);
  assert.equal(syncReads, 1);

  const reread = await readState();
  assert.equal(reread.schemaVersion, 4);
  assert.equal(syncReads, 1);
  assert.equal(syncData.schemaVersion, 3);
});

test("整份替换写入 local，不写回 Sync", async () => {
  const localData: Record<string, unknown> = {};
  const syncData: Record<string, unknown> = { schemaVersion: 3, siteRules: {}, pageRules: {} };
  installChromeStorageMock(localData, syncData);
  await replaceState(createDefaultState());
  assert.equal(localData.schemaVersion, 4);
  assert.equal(syncData.schemaVersion, 3);
});

function makePersonalRule(overrides: Partial<PersonalRule> = {}): PersonalRule {
  return {
    id: "rule-1",
    name: "规则",
    enabled: true,
    scope: { type: "site", hostname: "example.com" },
    order: 0,
    action: "new-tab",
    match: {},
    sensitiveEnabled: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function installChromeStorageMock(
  localData: Record<string, unknown>,
  syncData: Record<string, unknown>,
  onSyncRead: () => void = () => undefined,
): void {
  const createArea = (data: Record<string, unknown>, onRead: () => void = () => undefined) => ({
    async get(keys: string | string[]) {
      onRead();
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(value: Record<string, unknown>) { Object.assign(data, structuredClone(value)); },
    async remove(keys: string | string[]) {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete data[key]);
    },
  });
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { storage: { local: createArea(localData), sync: createArea(syncData, onSyncRead) } },
  });
}
