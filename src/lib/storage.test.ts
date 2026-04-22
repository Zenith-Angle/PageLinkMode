import test from "node:test";
import assert from "node:assert/strict";

import { parseImportedState } from "./storage";

test("旧版配置导入时会自动补齐 v0.4.0 分类规则字段", () => {
  const state = parseImportedState({
    globalMode: "new-tab",
    siteRules: {
      "linux.do": "same-tab",
    },
    pageRules: {
      "https://linux.do/latest": "new-tab",
    },
    disabledSites: ["example.com"],
  });

  assert.equal(state.schemaVersion, 2);
  assert.equal(state.globalCategoryRules["same-origin-content-link"], "new-tab");
  assert.equal(state.globalCategoryRules["pagination-navigation"], "preserve-native");
  assert.deepEqual(state.siteCategoryRules, {});
  assert.equal(state.siteRules["linux.do"], "same-tab");
  assert.equal(state.pageRules["https://linux.do/latest"], "new-tab");
});

test("站点分类覆写导入时允许 preserve-native，并自动清理 inherit 项", () => {
  const state = parseImportedState({
    globalMode: "new-tab",
    globalCategoryRules: {
      "same-origin-content-link": "new-tab",
      "cross-origin-content-link": "new-tab",
      "site-shell-navigation": "same-tab",
      "pagination-navigation": "preserve-native",
      "image-viewer-link": "preserve-native",
      "auth-link": "same-tab",
      "get-form-submit": "preserve-native",
      "non-get-form-submit": "same-tab",
      "window-open": "new-tab",
      "auth-window-open": "preserve-native",
      "image-window-open": "preserve-native",
      "named-or-popup-window-open": "preserve-native",
    },
    siteCategoryRules: {
      "LINUX.DO": {
        "same-origin-content-link": "inherit",
        "pagination-navigation": "preserve-native",
        "window-open": "same-tab",
      },
    },
    siteRules: {},
    pageRules: {},
  });

  assert.deepEqual(state.siteCategoryRules["linux.do"], {
    "pagination-navigation": "preserve-native",
    "window-open": "same-tab",
  });
});
