import type {
  NavigationCategory,
  NavigationDecision,
  NavigationDecisionSource,
  NavigationResolutionContext,
} from "./types";
import {
  isLikelyImageViewerNavigation,
  isLikelyImageViewerUrl,
  isLikelyPaginationNavigation,
} from "./navigation-heuristics";
import { parseUrl } from "./url";

const AUTH_KEYWORDS = [
  "login",
  "signin",
  "sign-in",
  "logout",
  "signout",
  "sign-out",
  "auth",
  "oauth",
  "callback",
  "session",
  "sso",
  "verify",
  "2fa",
  "captcha",
];

const SHELL_HINTS = /(?:home|homepage|logo|dashboard|index|main|首页|主页|主站)/i;
const POPUP_HINTS = ["popup", "width", "height", "toolbar", "menubar", "resizable"];

interface NavigationClassification {
  category: NavigationCategory;
  reason: string;
}

export function classifyAnchorNavigation(
  anchor: HTMLAnchorElement,
  currentUrl: string,
): NavigationClassification {
  const href = anchor.href;

  if (isLikelyImageViewerNavigation(anchor, href)) {
    return { category: "image-viewer-link", reason: "image-viewer-navigation" };
  }

  if (!isSameOriginNavigation(currentUrl, href)) {
    return { category: "cross-origin-content-link", reason: "cross-origin-content-link" };
  }

  if (isLikelyAuthUrl(href)) {
    return { category: "auth-link", reason: "same-origin-auth-link" };
  }

  if (isSiteRootNavigation(href) || isLikelyShellNavigation(anchor, currentUrl, href)) {
    return { category: "site-shell-navigation", reason: "shell-navigation" };
  }

  if (isLikelyPaginationNavigation(anchor, href)) {
    return { category: "pagination-navigation", reason: "pagination-navigation" };
  }

  return { category: "same-origin-content-link", reason: "same-origin-content-link" };
}

export function classifyFormNavigation(form: HTMLFormElement): NavigationClassification {
  const method = (form.method || "get").toUpperCase();
  if (method === "GET") {
    return { category: "get-form-submit", reason: "get-form-submit" };
  }

  return { category: "non-get-form-submit", reason: "non-get-form-submit" };
}

export function classifyWindowOpen(
  url: URL,
  target: string | undefined,
  features: string | undefined,
): NavigationClassification {
  if (isLikelyAuthUrl(url.toString())) {
    return { category: "auth-window-open", reason: "auth-window-open" };
  }

  if (isLikelyImageViewerUrl(url.toString())) {
    return { category: "image-window-open", reason: "image-viewer-window-open" };
  }

  if ((target && target !== "_blank") || isPopupLikeWindowOpen(features)) {
    return { category: "named-or-popup-window-open", reason: "named-or-popup-window-open" };
  }

  return { category: "window-open", reason: "content-window-open" };
}

export function resolveNavigationDecision(
  classification: NavigationClassification,
  context: NavigationResolutionContext,
): NavigationDecision {
  const resolved = resolveNavigationDisposition(classification.category, context);
  return {
    category: classification.category,
    reason: classification.reason,
    disposition: resolved.disposition,
    resolvedBy: resolved.resolvedBy,
  };
}

export function resolveNavigationDisposition(
  category: NavigationCategory,
  context: NavigationResolutionContext,
): Pick<NavigationDecision, "disposition" | "resolvedBy"> {
  if (!context.siteEnabled) {
    return { disposition: "preserve-native", resolvedBy: "disabled" };
  }

  if (context.pageMode !== "inherit") {
    return { disposition: context.pageMode, resolvedBy: "page" };
  }

  if (context.siteMode !== "inherit") {
    return { disposition: context.siteMode, resolvedBy: "site" };
  }

  const siteRule = context.siteCategoryRules[category];
  if (siteRule && siteRule !== "inherit") {
    return { disposition: siteRule, resolvedBy: "site-category" };
  }

  return {
    disposition: context.globalCategoryRules[category],
    resolvedBy: "global-category",
  };
}

export function isSameOriginNavigation(currentUrl: string, nextUrl: string): boolean {
  const current = parseUrl(currentUrl);
  const next = parseUrl(nextUrl);
  return current !== null && next !== null && current.origin === next.origin;
}

export function isSiteRootNavigation(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl);
  if (parsed === null) {
    return false;
  }

  return parsed.pathname === "/" || parsed.pathname === "";
}

export function isLikelyAuthUrl(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl);
  if (parsed === null) {
    return false;
  }

  const combined = `${parsed.pathname}${parsed.search}`.toLowerCase();
  return AUTH_KEYWORDS.some((keyword) => combined.includes(keyword));
}

export function isLikelyShellNavigation(
  anchor: HTMLAnchorElement,
  currentUrl: string,
  targetUrl: string,
): boolean {
  if (!isSameOriginNavigation(currentUrl, targetUrl)) {
    return false;
  }

  if (anchor.closest("header, nav, aside, [role='navigation']") !== null) {
    if (anchor.querySelector("img, svg") !== null) {
      return true;
    }

    if (SHELL_HINTS.test(getElementHints(anchor))) {
      return true;
    }
  }

  const parsed = parseUrl(targetUrl);
  if (parsed === null) {
    return false;
  }

  return /^\/(?:home|homepage|dashboard|index)?\/?$/i.test(parsed.pathname);
}

export function isPopupLikeWindowOpen(features: string | undefined): boolean {
  if (!features) {
    return false;
  }

  const normalized = features.toLowerCase();
  return POPUP_HINTS.some((hint) => normalized.includes(hint));
}

function getElementHints(anchor: HTMLAnchorElement): string {
  const elements = [anchor, anchor.parentElement, anchor.closest("[data-testid], [aria-label], [title], [role]")]
    .filter((value): value is Element => value instanceof Element);

  return elements
    .map((element) =>
      [
        element.getAttribute("aria-label") ?? "",
        element.getAttribute("title") ?? "",
        element.getAttribute("data-testid") ?? "",
        element.id,
        element.className,
        element.textContent ?? "",
      ].join(" "),
    )
    .join(" ")
    .trim();
}
