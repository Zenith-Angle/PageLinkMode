import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultState } from "./storage";
import { resolveContext } from "./rules";
import type { PersonalRule } from "./types";

test("页面运行上下文只包含当前站点和当前页面可能命中的个性化规则", () => {
  const state = createDefaultState();
  state.personalRules = [
    createRule("site-current", { type: "site", hostname: "example.com" }),
    createRule("page-current", { type: "page", hostname: "example.com", pageKey: "https://example.com/list" }),
    createRule("page-other", { type: "page", hostname: "example.com", pageKey: "https://example.com/account" }),
    createRule("site-secret", { type: "site", hostname: "private.example" }),
  ];

  const context = resolveContext("https://example.com/list#section", state);

  assert.deepEqual(context.personalRules.map((rule) => rule.id), ["site-current", "page-current"]);
});

function createRule(id: string, scope: PersonalRule["scope"]): PersonalRule {
  return {
    id,
    name: id,
    enabled: true,
    scope,
    order: 0,
    action: "new-tab",
    match: {},
    sensitiveEnabled: false,
    createdAt: 1,
    updatedAt: 1,
  };
}
