import test from "node:test";
import assert from "node:assert/strict";

import {
  acceptReportedWindowOpenOutcome,
  classifyAnchorNavigation,
  classifyFormNavigation,
  classifyNavigationFacts,
  classifyNavigationRelation,
  classifyWindowOpen,
  getEffectiveFormMethod,
  resolveNavigationDecision,
} from "./navigation";
import { createDefaultGlobalCategoryRules } from "./navigation-categories";
import { matchesPersonalRule, matchesUrl } from "./personal-rules";
import type {
  NavigationCapability,
  NavigationCategory,
  NavigationFacts,
  NavigationResolutionContext,
  PersonalRule,
} from "./types";

class MockElement {
  textContent = "";
  rel = "";
  id = "";
  className = "";
  parentElement: MockElement | null = null;
  tagName = "A";
  href = "";
  target = "";
  ownerDocument: Document | undefined;
  private readonly values: Record<string, string>;
  private readonly closestMatcher?: (selector: string) => MockElement | null;
  private readonly queryMatcher?: (selector: string) => MockElement | null;

  constructor(options: {
    textContent?: string;
    rel?: string;
    id?: string;
    className?: string;
    href?: string;
    target?: string;
    attributes?: Record<string, string>;
    closestMatcher?: (selector: string) => MockElement | null;
    queryMatcher?: (selector: string) => MockElement | null;
  } = {}) {
    Object.assign(this, options);
    this.values = { ...(options.attributes ?? {}) };
    if (options.rel) this.values.rel = options.rel;
    if (options.target) this.values.target = options.target;
    if (options.id) this.values.id = options.id;
    if (options.className) this.values.class = options.className;
    this.closestMatcher = options.closestMatcher;
    this.queryMatcher = options.queryMatcher;
  }

  closest(selector: string): MockElement | null {
    return this.closestMatcher?.(selector) ?? null;
  }

  querySelector(selector: string): MockElement | null {
    return this.queryMatcher?.(selector) ?? null;
  }

  getAttribute(name: string): string | null {
    return this.values[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return name in this.values;
  }

  matches(selector: string): boolean {
    return this.closestMatcher?.(selector) === this;
  }
}

Object.assign(globalThis, { Element: MockElement });

test("Public Suffix List 区分同站子域与不同私有站点", () => {
  assert.equal(
    classifyNavigationRelation("https://www.example.co.uk/a", "https://docs.example.co.uk/b"),
    "same-site",
  );
  assert.equal(
    classifyNavigationRelation("https://alice.github.io/a", "https://bob.github.io/b"),
    "cross-site",
  );
  assert.equal(
    classifyNavigationRelation("https://example.com/a#old", "https://example.com/a#new"),
    "same-document",
  );
});

test("IPv6 与 IDN/punycode 地址保持稳定的同站边界", () => {
  assert.equal(
    classifyNavigationRelation("https://[2001:db8::1]:443/a", "https://[2001:db8::1]:8443/b"),
    "same-site",
  );
  assert.equal(
    classifyNavigationRelation("https://[2001:db8::1]/a", "https://[2001:db8::2]/b"),
    "cross-site",
  );

  const unicodeDomain = "例子.公司.cn";
  const punycodeDomain = new URL(`https://${unicodeDomain}/`).hostname;
  assert.equal(
    classifyNavigationRelation(`https://阅读.${unicodeDomain}/a`, `https://docs.${punycodeDomain}/b`),
    "same-site",
  );
});

test("认证主机优先于 session 等内容路径进入高风险分类", () => {
  for (const href of [
    "https://auth.example.com/session",
    "https://accounts.example.com/docs/callback",
    "https://login.example.com/blog",
  ]) {
    const facts = classifyAnchorNavigation(
      new MockElement({ href }) as unknown as HTMLAnchorElement,
      "https://www.example.com/list",
    );

    assert.deepEqual(facts.semantics, ["auth-account"]);
    assert.equal(facts.capability.risk, "sensitive");
    assert.equal(classifyNavigationFacts(facts).category, "link-auth-account");
  }
});

test("27 个基础分类均可由正交事实稳定映射", () => {
  const cases: Array<[NavigationCategory, Partial<NavigationFacts>]> = [
    ["link-same-origin", { relation: "same-origin" }],
    ["link-same-site", { relation: "same-site" }],
    ["link-cross-site", { relation: "cross-site" }],
    ["link-site-root", { semantics: ["site-root"] }],
    ["link-primary-navigation", { semantics: ["primary-navigation"] }],
    ["link-breadcrumb-tab", { semantics: ["breadcrumb-tab"] }],
    ["link-list-detail", { semantics: ["list-detail"] }],
    ["link-pagination", { semantics: ["pagination"] }],
    ["link-content-sequence", { semantics: ["content-sequence"] }],
    ["link-search-filter", { semantics: ["search-filter"] }],
    ["link-image-gallery", { semantics: ["image-gallery"] }],
    ["link-document", { semantics: ["document"] }],
    ["link-media", { semantics: ["media"] }],
    ["link-spa-route", { semantics: ["spa-route"] }],
    ["link-auth-account", { semantics: ["auth-account"] }],
    ["link-payment-checkout", { semantics: ["payment-checkout"] }],
    ["form-search-get", { trigger: "form", formMethod: "GET", semantics: ["search-filter"] }],
    ["form-general-get", { trigger: "form", formMethod: "GET", semantics: ["unknown"] }],
    ["form-non-get", { trigger: "form", formMethod: "POST", semantics: ["unknown"] }],
    ["form-auth-payment", { trigger: "form", formMethod: "GET", semantics: ["auth-account"] }],
    ["open-same-origin", { trigger: "window.open", relation: "same-origin" }],
    ["open-same-site", { trigger: "window.open", relation: "same-site" }],
    ["open-cross-site", { trigger: "window.open", relation: "cross-site" }],
    ["open-image-gallery", { trigger: "window.open", semantics: ["image-gallery"] }],
    ["open-document-media", { trigger: "window.open", semantics: ["document"] }],
    ["open-auth-payment", { trigger: "window.open", semantics: ["payment-checkout"] }],
    ["open-popup-named", { trigger: "window.open", semantics: ["popup"] }],
  ];

  for (const [expected, overrides] of cases) {
    assert.equal(classifyNavigationFacts(createFacts(overrides)).category, expected, expected);
  }
});

test("链接语义覆盖首页、分页、文档、媒体和跨站普通内容", () => {
  const base = "https://www.example.com/list?page=1";
  const cases: Array<[NavigationCategory, MockElement]> = [
    ["link-site-root", new MockElement({ href: "https://www.example.com/" })],
    [
      "link-pagination",
      new MockElement({
        href: "https://www.example.com/list?page=2",
        textContent: "下一页",
        closestMatcher: (selector) => selector.includes("pagination") ? new MockElement() : null,
      }),
    ],
    ["link-document", new MockElement({ href: "https://www.example.com/files/report.pdf" })],
    ["link-media", new MockElement({ href: "https://www.example.com/media/demo.mp4" })],
    ["link-cross-site", new MockElement({ href: "https://other.example.net/article/1" })],
  ];

  for (const [expected, element] of cases) {
    const facts = classifyAnchorNavigation(element as unknown as HTMLAnchorElement, base);
    assert.equal(classifyNavigationFacts(facts).category, expected);
  }
});

test("敏感 GET action 进入认证支付表单，不能伪装成普通 GET", () => {
  const form = createForm({
    method: "GET",
    action: "https://accounts.example.com/oauth/authorize?client_id=abc",
  });
  const facts = classifyFormNavigation(form, null, "https://shop.example.com/cart");
  const decision = resolveNavigationDecision(facts, createContext({ pageMode: "new-tab" }));

  assert.equal(classifyNavigationFacts(facts).category, "form-auth-payment");
  assert.equal(facts.capability.risk, "sensitive");
  assert.equal(decision.resolvedBy, "risk");
  assert.equal(decision.requestedDisposition, "preserve-native");
  assert.equal(decision.applied, false);
});

test("高风险行为必须同时具备站点授权和逐条敏感规则", () => {
  const facts = createFacts({
    semantics: ["payment-checkout"],
    capability: { canRewrite: true, risk: "sensitive", blockers: [] },
  });
  const sensitiveRule = createRule({
    id: "pay",
    sensitiveEnabled: true,
    match: { semantics: ["payment-checkout"] },
  });

  const noGrant = resolveNavigationDecision(facts, createContext({ personalRules: [sensitiveRule] }));
  const noRule = resolveNavigationDecision(
    facts,
    createContext({ riskGrant: { hostname: "example.com", grantedAt: 1, confirmationVersion: 1 } }),
  );
  const granted = resolveNavigationDecision(
    facts,
    createContext({
      personalRules: [sensitiveRule],
      riskGrant: { hostname: "example.com", grantedAt: 1, confirmationVersion: 1 },
    }),
  );

  assert.equal(noGrant.reason, "risk-grant-required");
  assert.equal(noRule.reason, "sensitive-rule-required");
  assert.equal(granted.resolvedBy, "personal-site");
  assert.equal(granted.winningRuleId, "pay");
  assert.equal(granted.applied, true);
});

test("同 URL 的 POST 表单不会被普通链接的同文档硬限制拦截", () => {
  const sourceUrl = "https://example.com/forms";
  const form = createForm({ method: "POST", action: sourceUrl });
  const facts = classifyFormNavigation(form, null, sourceUrl);
  const rule = createRule({
    id: "same-url-post",
    action: "new-tab",
    sensitiveEnabled: true,
    match: { triggers: ["form"], formMethods: ["POST"] },
  });
  const decision = resolveNavigationDecision(facts, createContext({
    personalRules: [rule],
    riskGrant: { hostname: "example.com", grantedAt: 1, confirmationVersion: 1 },
  }));

  assert.equal(facts.relation, "same-document");
  assert.equal(facts.capability.risk, "sensitive");
  assert.equal(facts.capability.blockers.includes("same-document-navigation"), false);
  assert.equal(decision.resolvedBy, "personal-site");
  assert.equal(decision.winningRuleId, "same-url-post");
  assert.equal(decision.disposition, "new-tab");
  assert.equal(decision.applied, true);
});

test("页面个性化、页面整体、站点个性化、站点整体和分类规则按固定优先级执行", () => {
  const facts = createFacts();
  const pagePersonal = createRule({
    id: "page",
    order: 2,
    action: "same-tab",
    scope: { type: "page", hostname: "example.com", pageKey: "https://example.com/source" },
  });
  const sitePersonal = createRule({ id: "site", order: 1, action: "preserve-native" });
  const base = createContext({
    pageMode: "new-tab",
    siteMode: "same-tab",
    personalRules: [sitePersonal, pagePersonal],
    siteCategoryRules: { "link-same-origin": "same-tab" },
  });

  assert.equal(resolveNavigationDecision(facts, base).resolvedBy, "personal-page");
  assert.equal(resolveNavigationDecision(facts, { ...base, personalRules: [sitePersonal] }).resolvedBy, "page");
  assert.equal(
    resolveNavigationDecision(facts, { ...base, pageMode: "inherit", personalRules: [sitePersonal] }).resolvedBy,
    "personal-site",
  );
  assert.equal(
    resolveNavigationDecision(facts, { ...base, pageMode: "inherit", personalRules: [] }).resolvedBy,
    "site",
  );
  assert.equal(
    resolveNavigationDecision(facts, { ...base, pageMode: "inherit", siteMode: "inherit", personalRules: [] }).resolvedBy,
    "site-category",
  );
});

test("语义子分类依次继承站点父分类和全局父分类，直接值优先", () => {
  const facts = createFacts({
    relation: "same-origin",
    semantics: ["document"],
  });
  const globalCategoryRules = {
    ...createDefaultGlobalCategoryRules(),
    "link-document": "inherit" as const,
    "link-same-origin": "new-tab" as const,
  };

  const globalParent = resolveNavigationDecision(facts, createContext({ globalCategoryRules }));
  const siteParent = resolveNavigationDecision(facts, createContext({
    globalCategoryRules,
    siteCategoryRules: { "link-document": "inherit", "link-same-origin": "same-tab" },
  }));
  const siteChild = resolveNavigationDecision(facts, createContext({
    globalCategoryRules,
    siteCategoryRules: { "link-document": "new-tab", "link-same-origin": "same-tab" },
  }));

  assert.equal(globalParent.resolvedBy, "global-category");
  assert.equal(globalParent.requestedDisposition, "new-tab");
  assert.equal(siteParent.resolvedBy, "site-category");
  assert.equal(siteParent.requestedDisposition, "same-tab");
  assert.equal(siteChild.resolvedBy, "site-category");
  assert.equal(siteChild.requestedDisposition, "new-tab");
});

test("同一作用域按 order 首条命中，RE2/glob 和受限 selector 均可组合", () => {
  const facts = createFacts({
    targetUrl: "https://example.com/docs/report-2026.pdf",
    elementTag: "a",
    elementAttributes: { id: "report", class: "card primary", "data-kind": "pdf" },
  });
  const later = createRule({ id: "later", order: 20, action: "same-tab" });
  const first = createRule({
    id: "first",
    order: 10,
    action: "new-tab",
    match: {
      targetUrl: { kind: "regex", value: "/docs/report-[0-9]+\\.pdf$" },
      element: { selector: "a#report.card[data-kind='pdf']" },
    },
  });
  const decision = resolveNavigationDecision(facts, createContext({ personalRules: [later, first] }));

  assert.equal(decision.winningRuleId, "first");
  assert.equal(matchesUrl({ kind: "glob", value: "https://example.com/docs/*.pdf" }, facts.targetUrl), true);
  assert.equal(matchesPersonalRule(first.match, facts), true);
  assert.equal(matchesUrl({ kind: "regex", value: "(?=unsafe)" }, facts.targetUrl), false);
});

test("命名弹窗、无用户激活和修饰键属于不可解锁硬限制", () => {
  const popup = classifyWindowOpen(
    new URL("https://example.com/report"),
    "report-panel",
    "width=800,height=600",
    "https://example.com/source",
  );
  const modified = createFacts({
    userIntent: "modified",
    capability: { canRewrite: false, risk: "hard-blocked", blockers: ["explicit-user-intent"] },
  });
  const context = createContext({ pageMode: "new-tab" });

  assert.equal(classifyNavigationFacts(popup).category, "open-popup-named");
  assert.equal(resolveNavigationDecision(popup, context).resolvedBy, "capability");
  assert.equal(resolveNavigationDecision(modified, context).resolvedBy, "capability");
});

test("非空 referrerpolicy 和空 attributionsrc 属性都属于链接硬限制", () => {
  const cases: Array<[Record<string, string>, string]> = [
    [{ referrerpolicy: "no-referrer" }, "referrer-policy"],
    [{ attributionsrc: "" }, "attribution-source"],
  ];

  for (const [attributes, blocker] of cases) {
    const facts = classifyAnchorNavigation(
      new MockElement({
        href: "https://example.com/target",
        attributes,
      }) as unknown as HTMLAnchorElement,
      "https://example.com/source",
    );
    const decision = resolveNavigationDecision(facts, createContext({ pageMode: "new-tab" }));

    assert.equal(facts.capability.canRewrite, false);
    assert.ok(facts.capability.blockers.includes(blocker));
    assert.equal(decision.resolvedBy, "capability");
    assert.equal(decision.applied, false);
  }
});

test("外部协议、特殊属性和 frame 目标在风险授权后仍保持原生", () => {
  const currentUrl = "https://example.com/article#old";
  const unlockedContext = createContext({
    pageMode: "new-tab",
    riskGrant: { hostname: "example.com", grantedAt: 1, confirmationVersion: 1 },
    personalRules: [createRule({
      id: "unlocked-sensitive-rule",
      sensitiveEnabled: true,
      action: "new-tab",
    })],
  });
  const cases: Array<{ name: string; facts: NavigationFacts; blocker: string }> = [
    {
      name: "external-protocol",
      facts: classifyAnchorNavigation(
        new MockElement({ href: "mailto:user@example.com" }) as unknown as HTMLAnchorElement,
        currentUrl,
      ),
      blocker: "unsupported-protocol",
    },
    ...([
      [{ download: "" }, "download-attribute"],
      [{ ping: "https://tracker.example/p" }, "ping-attribution"],
      [{ attributionsrc: "" }, "attribution-source"],
      [{ rel: "noopener" }, "special-rel-semantics"],
      [{ rel: "noreferrer" }, "special-rel-semantics"],
      [{ rel: "opener" }, "special-rel-semantics"],
      [{ referrerpolicy: "origin" }, "referrer-policy"],
    ] as Array<[Record<string, string>, string]>).map(([attributes, blocker]) => ({
      name: blocker,
      facts: classifyAnchorNavigation(
        new MockElement({ href: "https://example.com/target", attributes }) as unknown as HTMLAnchorElement,
        currentUrl,
      ),
      blocker,
    })),
    ...(["_parent", "_top", "_unfencedTop"] as const).map((target) => ({
      name: target,
      facts: classifyAnchorNavigation(
        new MockElement({ href: "https://example.com/frame-target", target }) as unknown as HTMLAnchorElement,
        currentUrl,
        { frameContext: "cross-origin-frame" },
      ),
      blocker: "special-or-named-target",
    })),
    {
      name: "same-document-hash",
      facts: classifyAnchorNavigation(
        new MockElement({ href: "https://example.com/article#section" }) as unknown as HTMLAnchorElement,
        currentUrl,
      ),
      blocker: "same-document-navigation",
    },
  ];

  for (const { name, facts, blocker } of cases) {
    const decision = resolveNavigationDecision(facts, unlockedContext);
    assert.equal(facts.capability.risk, "hard-blocked", name);
    assert.ok(facts.capability.blockers.includes(blocker), name);
    assert.equal(decision.resolvedBy, "capability", name);
    assert.equal(decision.requestedDisposition, "preserve-native", name);
    assert.equal(decision.applied, false, name);
  }

  const spaHashFacts = classifyAnchorNavigation(
    new MockElement({ href: "https://example.com/article#/settings" }) as unknown as HTMLAnchorElement,
    currentUrl,
  );
  assert.ok(spaHashFacts.semantics.includes("spa-route"));
  assert.equal(spaHashFacts.capability.risk, "normal");
});

test("NavigationDecision 区分请求、原生、最终动作及是否实际改写", () => {
  const rewrite = resolveNavigationDecision(
    createFacts({ nativeDisposition: "same-tab", nativeTarget: "self" }),
    createContext(),
  );
  const alreadyNative = resolveNavigationDecision(
    createFacts({ nativeDisposition: "new-tab", nativeTarget: "blank" }),
    createContext(),
  );

  assert.deepEqual(
    {
      requested: rewrite.requestedDisposition,
      native: rewrite.nativeDisposition,
      final: rewrite.disposition,
      applied: rewrite.applied,
    },
    { requested: "new-tab", native: "same-tab", final: "new-tab", applied: true },
  );
  assert.equal(alreadyNative.applied, false);
  assert.equal(alreadyNative.bypassReason, "already-native");
});

test("MAIN bridge 只接受受约束的 popup-blocked 实际结果", () => {
  const expected = resolveNavigationDecision(
    createFacts({
      trigger: "window.open",
      nativeTarget: "self",
      nativeDisposition: "same-tab",
      userIntent: "script-active",
    }),
    createContext({
      globalCategoryRules: {
        ...createDefaultGlobalCategoryRules(),
        "open-same-origin": "new-tab",
      },
    }),
  );
  const reported = {
    ...expected,
    disposition: expected.nativeDisposition,
    applied: false,
    bypassReason: "popup-blocked",
  };

  assert.deepEqual(acceptReportedWindowOpenOutcome(expected, reported), reported);
  assert.deepEqual(
    acceptReportedWindowOpenOutcome(expected, { ...reported, requestedDisposition: "same-tab" }),
    expected,
  );
  assert.deepEqual(
    acceptReportedWindowOpenOutcome(expected, { ...reported, bypassReason: "forged-reason" }),
    expected,
  );
});

test("submitter 的枚举属性覆盖遵循浏览器 GET 回退规则", () => {
  const postForm = createForm({ method: "POST", action: "https://example.com/search" });
  const submitter = {
    hasAttribute: (name: string) => name === "formmethod",
    getAttribute: (name: string) => name === "formmethod" ? "" : null,
  } as unknown as HTMLElement;
  assert.equal(getEffectiveFormMethod(postForm, submitter), "GET");
});

function createFacts(overrides: Partial<NavigationFacts> = {}): NavigationFacts {
  const capability: NavigationCapability = { canRewrite: true, risk: "normal", blockers: [] };
  return {
    trigger: "anchor",
    sourceUrl: "https://example.com/source",
    targetUrl: "https://example.com/target",
    relation: "same-origin",
    protocol: "https:",
    semantics: ["content"],
    nativeTarget: "self",
    nativeDisposition: "same-tab",
    frameContext: "top",
    userIntent: "plain",
    evidence: [],
    capability,
    ...overrides,
  };
}

function createContext(
  overrides: Partial<NavigationResolutionContext> = {},
): NavigationResolutionContext {
  return {
    siteEnabled: true,
    pageMode: "inherit",
    siteMode: "inherit",
    globalCategoryRules: createDefaultGlobalCategoryRules(),
    siteCategoryRules: {},
    personalRules: [],
    ...overrides,
  };
}

function createRule(overrides: Partial<PersonalRule> = {}): PersonalRule {
  return {
    id: "rule",
    name: "测试规则",
    enabled: true,
    scope: { type: "site", hostname: "example.com" },
    order: 1,
    action: "new-tab",
    match: {},
    sensitiveEnabled: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createForm(options: { method: string; action: string }): HTMLFormElement {
  return {
    method: options.method,
    action: options.action,
    target: "",
    id: "",
    className: "",
    textContent: "",
    ownerDocument: undefined,
    hasAttribute: () => false,
    getAttribute: () => null,
    matches: () => false,
    querySelector: () => null,
  } as unknown as HTMLFormElement;
}
