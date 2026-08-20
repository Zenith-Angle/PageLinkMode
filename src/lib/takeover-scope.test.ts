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
import {
  createPresetCategoryRules,
  DEFAULT_PRESET_ID,
  NAVIGATION_CATEGORY_ORDER,
} from "./navigation-categories";
import type { BasicPresetId, NavigationCategory } from "./types";

const PRESET_ORDER: Array<Exclude<BasicPresetId, "custom">> = [
  "precise",
  "content",
  "broad",
  "deep",
  "widest",
];

test("五档资格层按使用频率单调覆盖全部 v4 基础分类", () => {
  assert.deepEqual(TAKEOVER_SCOPE_LEVELS.map((definition) => definition.level), [0, 1, 2, 3, 4]);
  for (const category of NAVIGATION_CATEGORY_ORDER) {
    const minimumLevel = getMinimumTakeoverScopeLevel(category);
    assert.equal(isCategoryWithinTakeoverScope(category, minimumLevel), true);
  }
  assert.deepEqual(TAKEOVER_SCOPE_LEVELS.map(({ level }) => countCategoriesWithinTakeoverScope(level)), [1, 6, 10, 16, 29]);
});

test("敏感和硬原生分类保持保护，但 v4 锚点统一在 capture 阶段观察", () => {
  assert.equal(isSafetyProtectedCategory("link-auth-account"), true);
  assert.equal(isSafetyProtectedCategory("form-non-get"), true);
  assert.equal(isSafetyProtectedCategory("open-popup-named"), true);
  assert.equal(isSafetyProtectedCategory("link-same-origin"), false);
  assert.equal(shouldHandleAnchorInCapturePhase(0), true);
  assert.equal(shouldHandleAnchorInCapturePhase(4), true);
});

test("档位资格映射把敏感、翻页和脚本行为留到最高层", () => {
  assert.equal(isCategoryWithinTakeoverScope("link-same-origin", 0), true);
  assert.equal(isCategoryWithinTakeoverScope("link-cross-site", 0), false);
  assert.equal(isCategoryWithinTakeoverScope("link-cross-site", 1), true);
  assert.equal(isCategoryWithinTakeoverScope("link-auth-account", 3), false);
  assert.equal(isCategoryWithinTakeoverScope("link-auth-account", 4), true);
  assert.equal(isCategoryWithinTakeoverScope("form-general-get", 2), false);
  assert.equal(isCategoryWithinTakeoverScope("form-general-get", 3), true);
  assert.equal(isCategoryWithinTakeoverScope("open-same-origin", 3), false);
  assert.equal(isCategoryWithinTakeoverScope("open-same-origin", 4), true);
});

test("五档预设按日常使用频率递增，适中档作为新安装默认值", () => {
  assert.equal(DEFAULT_PRESET_ID, "broad");

  const activeCounts = PRESET_ORDER.map((preset) => {
    const rules = createPresetCategoryRules(preset);
    return NAVIGATION_CATEGORY_ORDER.filter((category) => rules[category] !== "preserve-native").length;
  });

  assert.deepEqual(activeCounts, [1, 6, 10, 16, 23]);
});

test("适中档覆盖多数日常浏览，但翻页和上一篇下一篇保持网站原生", () => {
  const rules = createPresetCategoryRules("broad");
  const expected: Partial<Record<NavigationCategory, string>> = {
    "link-same-origin": "new-tab",
    "link-same-site": "new-tab",
    "link-cross-site": "new-tab",
    "link-site-root": "same-tab",
    "link-primary-navigation": "same-tab",
    "link-breadcrumb-tab": "same-tab",
    "link-forum-facet": "same-tab",
    "link-forum-navigation": "preserve-native",
    "link-list-detail": "new-tab",
    "link-document": "new-tab",
    "link-media": "new-tab",
    "link-pagination": "preserve-native",
    "link-content-sequence": "preserve-native",
  };

  for (const [category, action] of Object.entries(expected)) {
    assert.equal(rules[category as NavigationCategory], action, category);
  }
});

test("论坛时间轴按预设逐级开放，最广档才改为新标签", () => {
  assert.equal(createPresetCategoryRules("broad")["link-forum-navigation"], "preserve-native");
  assert.equal(createPresetCategoryRules("deep")["link-forum-navigation"], "same-tab");
  assert.equal(createPresetCategoryRules("widest")["link-forum-navigation"], "new-tab");
});

test("翻页、上一篇下一篇和普通脚本打开只在最广档接管", () => {
  const restrictedCategories: NavigationCategory[] = [
    "link-pagination",
    "link-content-sequence",
    "open-same-origin",
    "open-same-site",
    "open-cross-site",
    "open-image-gallery",
    "open-document-media",
  ];

  for (const preset of PRESET_ORDER.slice(0, -1)) {
    const rules = createPresetCategoryRules(preset);
    for (const category of restrictedCategories) {
      assert.equal(rules[category], "preserve-native", `${preset}:${category}`);
    }
  }

  const widest = createPresetCategoryRules("widest");
  for (const category of restrictedCategories) {
    assert.equal(widest[category], "new-tab", category);
  }
});
