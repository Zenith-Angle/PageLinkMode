import test from "node:test";
import assert from "node:assert/strict";

import {
  TAKEOVER_SCOPE_LEVELS,
  countCategoriesWithinTakeoverScope,
  getMinimumTakeoverScopeLevel,
  isCategoryWithinTakeoverScope,
  isSafetyProtectedCategory,
  shouldHandleAnchorInCapturePhase,
} from "./takeover-scope";
import { NAVIGATION_CATEGORY_ORDER } from "./navigation-categories";

test("旧五档迁移层单调覆盖全部 v4 基础分类", () => {
  assert.deepEqual(TAKEOVER_SCOPE_LEVELS.map((definition) => definition.level), [0, 1, 2, 3, 4]);
  for (const category of NAVIGATION_CATEGORY_ORDER) {
    const minimumLevel = getMinimumTakeoverScopeLevel(category);
    assert.equal(isCategoryWithinTakeoverScope(category, minimumLevel), true);
  }
  assert.deepEqual(TAKEOVER_SCOPE_LEVELS.map(({ level }) => countCategoriesWithinTakeoverScope(level)), [1, 8, 16, 20, 27]);
});

test("敏感和硬原生分类保持保护，但 v4 锚点统一在 capture 阶段观察", () => {
  assert.equal(isSafetyProtectedCategory("link-auth-account"), true);
  assert.equal(isSafetyProtectedCategory("form-non-get"), true);
  assert.equal(isSafetyProtectedCategory("open-popup-named"), true);
  assert.equal(isSafetyProtectedCategory("link-same-origin"), false);
  assert.equal(shouldHandleAnchorInCapturePhase(0), true);
  assert.equal(shouldHandleAnchorInCapturePhase(4), true);
});

test("旧档位兼容映射按链接、表单和脚本打开递增", () => {
  assert.equal(isCategoryWithinTakeoverScope("link-same-origin", 0), true);
  assert.equal(isCategoryWithinTakeoverScope("link-cross-site", 0), false);
  assert.equal(isCategoryWithinTakeoverScope("link-cross-site", 1), true);
  assert.equal(isCategoryWithinTakeoverScope("link-auth-account", 1), false);
  assert.equal(isCategoryWithinTakeoverScope("link-auth-account", 2), true);
  assert.equal(isCategoryWithinTakeoverScope("form-general-get", 2), false);
  assert.equal(isCategoryWithinTakeoverScope("form-general-get", 3), true);
  assert.equal(isCategoryWithinTakeoverScope("open-same-origin", 3), false);
  assert.equal(isCategoryWithinTakeoverScope("open-same-origin", 4), true);
});
