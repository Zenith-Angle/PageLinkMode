import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyAnchorNavigation,
  classifyFormNavigation,
  classifyWindowOpen,
  resolveNavigationDecision,
} from "./navigation";
import { createDefaultGlobalCategoryRules } from "./navigation-categories";
import type { NavigationResolutionContext } from "./types";

class MockElement {
  private readonly options: {
    textContent?: string;
    rel?: string;
    id?: string;
    className?: string;
    parentElement?: MockElement | null;
    hasImage?: boolean;
    hasSvg?: boolean;
    closestMatcher?: (selector: string) => MockElement | null;
    attributes?: Record<string, string>;
  };
  textContent = "";
  rel = "";
  id = "";
  className = "";
  parentElement: MockElement | null = null;

  constructor(options: MockElement["options"] = {}) {
    this.options = options;
    this.textContent = options.textContent ?? "";
    this.rel = options.rel ?? "";
    this.id = options.id ?? "";
    this.className = options.className ?? "";
    this.parentElement = options.parentElement ?? null;
  }

  closest(selector: string): MockElement | null {
    return this.options.closestMatcher?.(selector) ?? null;
  }

  querySelector(selector: string): MockElement | null {
    if (selector === "img, picture" || selector === "img, svg") {
      return this.options.hasImage ? this : null;
    }
    if (selector === "svg") {
      return this.options.hasSvg ? this : null;
    }
    return null;
  }

  getAttribute(name: string): string | null {
    return this.options.attributes?.[name] ?? null;
  }
}

Object.assign(globalThis, {
  Element: MockElement,
});

test("普通跨站链接默认归类为跨站内容并在新标签页打开", () => {
  const anchor = new MockElement() as unknown as HTMLAnchorElement;
  Object.assign(anchor, { href: "https://other.example/post/1" });

  const decision = resolveNavigationDecision(
    classifyAnchorNavigation(anchor, "https://current.example/list"),
    createContext(),
  );

  assert.equal(decision.category, "cross-origin-content-link");
  assert.equal(decision.disposition, "new-tab");
  assert.equal(decision.resolvedBy, "global-category");
});

test("传统分页默认保持网页原生行为", () => {
  const anchor = new MockElement({
    textContent: "下一页",
    closestMatcher: (selector) =>
      selector.includes(".pagination") || selector.includes("pagination")
        ? new MockElement()
        : null,
  }) as unknown as HTMLAnchorElement;
  Object.assign(anchor, {
    href: "https://current.example/list?page=2",
  });

  const decision = resolveNavigationDecision(
    classifyAnchorNavigation(anchor, "https://current.example/list?page=1"),
    createContext(),
  );

  assert.equal(decision.category, "pagination-navigation");
  assert.equal(decision.disposition, "preserve-native");
});

test("图片查看入口默认保持网页原生行为", () => {
  const anchor = new MockElement({
    textContent: "查看原图",
    hasImage: true,
    closestMatcher: (selector) =>
      selector.includes("dialog") || selector.includes("lightbox")
        ? new MockElement()
        : null,
    attributes: { "aria-label": "查看原图" },
  }) as unknown as HTMLAnchorElement;
  Object.assign(anchor, {
    href: "https://current.example/image-viewer?id=8",
  });

  const decision = resolveNavigationDecision(
    classifyAnchorNavigation(anchor, "https://current.example/post/8"),
    createContext(),
  );

  assert.equal(decision.category, "image-viewer-link");
  assert.equal(decision.disposition, "preserve-native");
});

test("站点壳层导航默认回到同标签页", () => {
  const anchor = new MockElement({
    textContent: "首页",
    closestMatcher: (selector) =>
      selector.includes("header") || selector.includes("nav")
        ? new MockElement()
        : null,
  }) as unknown as HTMLAnchorElement;
  Object.assign(anchor, {
    href: "https://current.example/",
  });

  const decision = resolveNavigationDecision(
    classifyAnchorNavigation(anchor, "https://current.example/topic/42"),
    createContext(),
  );

  assert.equal(decision.category, "site-shell-navigation");
  assert.equal(decision.disposition, "same-tab");
});

test("GET 表单默认保持原生，非 GET 表单默认强制当前标签页", () => {
  const getForm = { method: "GET" } as HTMLFormElement;
  const postForm = { method: "POST" } as HTMLFormElement;

  const getDecision = resolveNavigationDecision(classifyFormNavigation(getForm), createContext());
  const postDecision = resolveNavigationDecision(classifyFormNavigation(postForm), createContext());

  assert.equal(getDecision.category, "get-form-submit");
  assert.equal(getDecision.disposition, "preserve-native");
  assert.equal(postDecision.category, "non-get-form-submit");
  assert.equal(postDecision.disposition, "same-tab");
});

test("window.open 的命名窗口和 popup 语义默认保持原生", () => {
  const namedTargetDecision = resolveNavigationDecision(
    classifyWindowOpen(new URL("https://current.example/report"), "report-panel", undefined),
    createContext(),
  );
  const popupDecision = resolveNavigationDecision(
    classifyWindowOpen(new URL("https://current.example/report"), "_blank", "width=800,height=600"),
    createContext(),
  );

  assert.equal(namedTargetDecision.category, "named-or-popup-window-open");
  assert.equal(namedTargetDecision.disposition, "preserve-native");
  assert.equal(popupDecision.category, "named-or-popup-window-open");
  assert.equal(popupDecision.disposition, "preserve-native");
});

test("规则优先级严格遵循 页面 > 站点 > 站点分类 > 全局分类", () => {
  const baseContext = createContext({
    siteCategoryRules: {
      "same-origin-content-link": "preserve-native",
    },
  });

  const globalDecision = resolveNavigationDecision(
    { category: "cross-origin-content-link", reason: "cross-origin" },
    baseContext,
  );
  const siteCategoryDecision = resolveNavigationDecision(
    { category: "same-origin-content-link", reason: "same-origin" },
    baseContext,
  );
  const siteDecision = resolveNavigationDecision(
    { category: "same-origin-content-link", reason: "same-origin" },
    { ...baseContext, siteMode: "same-tab" },
  );
  const pageDecision = resolveNavigationDecision(
    { category: "same-origin-content-link", reason: "same-origin" },
    { ...baseContext, siteMode: "new-tab", pageMode: "same-tab" },
  );

  assert.equal(globalDecision.resolvedBy, "global-category");
  assert.equal(siteCategoryDecision.resolvedBy, "site-category");
  assert.equal(siteCategoryDecision.disposition, "preserve-native");
  assert.equal(siteDecision.resolvedBy, "site");
  assert.equal(siteDecision.disposition, "same-tab");
  assert.equal(pageDecision.resolvedBy, "page");
  assert.equal(pageDecision.disposition, "same-tab");
});

function createContext(
  overrides: Partial<NavigationResolutionContext> = {},
): NavigationResolutionContext {
  return {
    siteEnabled: true,
    pageMode: "inherit",
    siteMode: "inherit",
    globalCategoryRules: createDefaultGlobalCategoryRules(),
    siteCategoryRules: {},
    ...overrides,
  };
}
