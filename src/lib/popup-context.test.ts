import test from "node:test";
import assert from "node:assert/strict";

import { normalizePopupContextResponse } from "./popup-context";

const CURRENT_CONTEXT = {
  url: "https://example.com/list?page=2",
  hostname: "example.com",
  pageKey: "https://example.com/list?page=2",
  siteEnabled: true,
  pageMode: "inherit",
  siteMode: "inherit",
  globalCategoryRules: {},
  siteCategoryRules: {},
  personalRules: [],
  effectiveMode: "preserve-native",
  effectiveSource: "category",
  supported: true,
  siteAuthorizationRecorded: true,
} as const;

test("Popup 接收 v4 后台上下文并保留基础分类状态", () => {
  const context = normalizePopupContextResponse(CURRENT_CONTEXT);
  assert.equal(context.hostname, "example.com");
  assert.equal(context.effectiveSource, "category");
  assert.deepEqual(context.personalRules, []);
});

test("Popup 为缺失的 v4 分类集合补齐安全默认值", () => {
  const { globalCategoryRules: _removed, personalRules: _rules, ...partial } = CURRENT_CONTEXT;
  const context = normalizePopupContextResponse(partial);
  assert.equal(context.globalCategoryRules["link-same-origin"], "new-tab");
  assert.deepEqual(context.personalRules, []);
});

test("Popup 不会把后台错误 envelope 当成上下文继续渲染", () => {
  assert.throws(() => normalizePopupContextResponse({ ok: false, error: "storage unavailable" }), /读取扩展状态失败：storage unavailable/);
  assert.throws(() => normalizePopupContextResponse({ ok: true }), /后台返回了不完整的页面状态/);
});
