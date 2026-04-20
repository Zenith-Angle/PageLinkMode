import type { NavigationDisposition, NavigationMode } from "./types";
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
const PAGINATION_CONTAINER_SELECTOR =
  ".nsk-pager, .pager, [aria-label='pagination'], [aria-label*='page' i], [aria-label*='分页']";
const PAGINATION_TEXT_PATTERN =
  /^(?:\d+|上一页|下一页|上一頁|下一頁|prev|previous|next|first|last)$/i;
const PAGINATION_PATH_PATTERN = /\/page-\d+\/?$/i;
const PAGINATION_QUERY_KEYS = ["page", "p", "pn", "paged"] as const;

export interface NavigationDecision {
  disposition: NavigationDisposition;
  reason: string;
}

export function classifyAnchorNavigation(
  anchor: HTMLAnchorElement,
  currentUrl: string,
  effectiveMode: NavigationMode,
): NavigationDecision {
  const href = anchor.href;
  if (effectiveMode === "same-tab") {
    return { disposition: "same-tab", reason: "effective-mode-same-tab" };
  }

  if (!isSameOriginNavigation(currentUrl, href)) {
    return { disposition: "new-tab", reason: "cross-origin-content-link" };
  }

  if (isLikelyAuthUrl(href)) {
    return { disposition: "same-tab", reason: "same-origin-auth-link" };
  }

  if (isSiteRootNavigation(href)) {
    return { disposition: "same-tab", reason: "site-root-navigation" };
  }

  if (isLikelyShellNavigation(anchor, currentUrl, href)) {
    return { disposition: "same-tab", reason: "shell-navigation" };
  }

  if (isLikelyPaginationNavigation(anchor, currentUrl, href)) {
    return { disposition: "same-tab", reason: "pagination-navigation" };
  }

  return { disposition: "new-tab", reason: "same-origin-content-link" };
}

export function classifyFormNavigation(
  form: HTMLFormElement,
  currentUrl: string,
  effectiveMode: NavigationMode,
): NavigationDecision {
  const actionUrl = form.action || currentUrl;
  const method = (form.method || "get").toUpperCase();
  const currentTarget = isAlreadyCurrentTarget(form);

  if (effectiveMode === "same-tab") {
    return currentTarget
      ? { disposition: "preserve-native", reason: "same-tab-native-form-submit" }
      : { disposition: "same-tab", reason: "same-tab-force-current-target" };
  }

  if (currentTarget) {
    if (method !== "GET") {
      return { disposition: "preserve-native", reason: "non-get-form-preserve-native" };
    }

    if (isLikelyAuthUrl(actionUrl)) {
      return { disposition: "preserve-native", reason: "auth-form-preserve-native" };
    }

    return { disposition: "preserve-native", reason: "get-form-preserve-native" };
  }

  if (method !== "GET") {
    return { disposition: "same-tab", reason: "non-get-form-force-current-tab" };
  }

  if (isLikelyAuthUrl(actionUrl)) {
    return { disposition: "same-tab", reason: "auth-form-force-current-tab" };
  }

  return { disposition: "same-tab", reason: "get-form-force-current-tab" };
}

export function classifyWindowOpen(
  url: URL,
  target: string | undefined,
  features: string | undefined,
  effectiveMode: NavigationMode,
): NavigationDecision {
  if (effectiveMode === "same-tab") {
    return { disposition: "same-tab", reason: "effective-mode-same-tab" };
  }

  if (isLikelyAuthUrl(url.toString())) {
    return { disposition: "preserve-native", reason: "auth-window-open" };
  }

  if (target && target !== "_blank") {
    return { disposition: "preserve-native", reason: "named-or-nonblank-target" };
  }

  if (isPopupLikeWindowOpen(features)) {
    return { disposition: "preserve-native", reason: "popup-window-open" };
  }

  return { disposition: "new-tab", reason: "content-window-open" };
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

export function isLikelyPaginationNavigation(
  anchor: HTMLAnchorElement,
  currentUrl: string,
  targetUrl: string,
): boolean {
  if (!isSameOriginNavigation(currentUrl, targetUrl)) {
    return false;
  }

  if (isPaginationContainerLink(anchor)) {
    return true;
  }

  if (hasPaginationClassSignal(anchor) || hasPaginationRelSignal(anchor)) {
    return true;
  }

  return hasPaginationTextSignal(anchor) && isPaginationUrl(currentUrl, targetUrl);
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

function isPaginationContainerLink(anchor: HTMLAnchorElement): boolean {
  return anchor.closest(PAGINATION_CONTAINER_SELECTOR) !== null;
}

function hasPaginationClassSignal(anchor: HTMLAnchorElement): boolean {
  return ["pager-pos", "pager-prev", "pager-next"].some((className) => anchor.classList.contains(className));
}

function hasPaginationRelSignal(anchor: HTMLAnchorElement): boolean {
  const rel = anchor.getAttribute("rel")?.trim().toLowerCase();
  return rel === "next" || rel === "prev";
}

function hasPaginationTextSignal(anchor: HTMLAnchorElement): boolean {
  const text = anchor.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return PAGINATION_TEXT_PATTERN.test(text);
}

function isPaginationUrl(currentUrl: string, targetUrl: string): boolean {
  const current = parseUrl(currentUrl);
  const target = parseUrl(targetUrl);
  if (current === null || target === null) {
    return false;
  }

  if (PAGINATION_PATH_PATTERN.test(target.pathname)) {
    return true;
  }

  return PAGINATION_QUERY_KEYS.some((key) => {
    const currentValue = current.searchParams.get(key);
    const targetValue = target.searchParams.get(key);
    return currentValue !== targetValue && isPositiveInteger(targetValue);
  });
}

function isPositiveInteger(value: string | null): boolean {
  return value !== null && /^\d+$/.test(value);
}

function isAlreadyCurrentTarget(form: HTMLFormElement): boolean {
  return form.target === "" || form.target === "_self";
}
