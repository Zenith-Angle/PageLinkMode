import { parseUrl } from "./url";
import type { NavigableLinkElement } from "./types";

const PAGINATION_CONTAINER_SELECTORS = [
  ".pagination",
  ".pager",
  ".page-numbers",
  "[class*='pagination' i]",
  "[class*='pager' i]",
  "[class*='page-numbers' i]",
  "[data-pagination]",
  "[data-testid*='pagination' i]",
  "[aria-label*='pagination' i]",
  "[aria-label*='page navigation' i]",
].join(", ");
const PAGINATION_KEYWORD_HINTS = /(?:pagination|pager|page-numbers|上一页|下一页|前一页|后一页|首页|尾页|prev|next|previous|first|last)/i;
const IMAGE_VIEWER_CONTAINER_SELECTORS = [
  "dialog",
  "[role='dialog']",
  "[aria-modal='true']",
  "[data-fancybox]",
  "[data-lightbox]",
  "[data-pswp]",
  "[class*='lightbox' i]",
  "[class*='image-viewer' i]",
  "[class*='photo-viewer' i]",
  "[class*='image-preview' i]",
  "[class*='photo-preview' i]",
  "[class*='gallery-viewer' i]",
].join(", ");
const IMAGE_VIEWER_HINTS = /(?:查看原图|原图|大图|查看图片|看大图|图片预览|相册|image viewer|photo viewer|lightbox|gallery|zoom)/i;
const IMAGE_VIEWER_URL_HINTS = /(?:\/(?:gallery|lightbox|zoom|original)(?:\/|$)|\/(?:image|photo)s?[-_/](?:viewer|preview)(?:\/|$)|\/(?:viewer|preview)[-_/](?:image|photo)s?(?:\/|$)|[?&#](?:image|photo|gallery|lightbox|zoom|original)=)/i;
const DIRECT_IMAGE_PATH_HINTS = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:$|[?#])/i;
const DOCUMENT_PATH_HINTS = /\.(?:csv|docx?|epub|md|od[pt]|pdf|pptx?|rtf|txt|xlsx?)(?:$|[?#])/i;
const MEDIA_PATH_HINTS = /\.(?:aac|flac|m4a|m4v|mkv|mov|mp3|mp4|mpeg|oga|ogg|ogv|opus|wav|webm)(?:$|[?#])/i;
const SEARCH_HINTS = /(?:search|query|filter|facet|sort|keyword|搜索|筛选|过滤|排序)/i;
const CONTENT_SEQUENCE_HINTS = /(?:上一篇|下一篇|上一章|下一章|上一节|下一节|previous article|next article|previous chapter|next chapter)/i;
const LIST_DETAIL_HINTS = /(?:card|item|entry|result|feed|list|article|post|topic|thread|detail|卡片|列表|详情|文章|帖子)/i;

export function isLikelyPaginationNavigation(
  anchor: NavigableLinkElement,
  targetUrl: string,
): boolean {
  const contextHints = getContextHints(anchor);
  const text = normalizeText(anchor.textContent ?? "");
  const relHint = /\b(?:prev|next)\b/i.test(anchor.rel);
  const containerHint =
    anchor.closest(PAGINATION_CONTAINER_SELECTORS) !== null ||
    PAGINATION_KEYWORD_HINTS.test(contextHints);
  const textHint = isPaginationText(text);
  const urlHint = isPaginationUrl(targetUrl);

  if (relHint) {
    return true;
  }

  if (containerHint && (textHint || urlHint)) {
    return true;
  }

  if (textHint && urlHint) {
    return true;
  }

  return containerHint && isNavigationContainer(anchor) && urlHint && hasPaginationArrowIcon(anchor);
}

export function isLikelyImageViewerNavigation(
  anchor: NavigableLinkElement,
  targetUrl: string,
): boolean {
  const hints = getElementHints(anchor);
  const previewContainer = anchor.closest(IMAGE_VIEWER_CONTAINER_SELECTORS) !== null;
  const previewHint = IMAGE_VIEWER_HINTS.test(hints);
  const imageSignal =
    isDirectImageUrl(targetUrl) ||
    anchor.querySelector("img, picture") !== null ||
    anchor.closest("figure, picture") !== null;
  const urlHint = isLikelyImageViewerUrl(targetUrl);

  if (previewContainer && (imageSignal || urlHint || previewHint)) {
    return true;
  }

  if (isDirectImageUrl(targetUrl) && (imageSignal || previewHint)) {
    return true;
  }

  if (previewHint && (imageSignal || urlHint)) {
    return true;
  }

  return imageSignal && urlHint;
}

export function isLikelyImageViewerUrl(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl);
  if (parsed === null) {
    return false;
  }

  return isDirectImageUrl(parsed.toString()) || IMAGE_VIEWER_URL_HINTS.test(`${parsed.pathname}${parsed.search}`);
}

export function isLikelyPrimaryNavigation(anchor: NavigableLinkElement): boolean {
  return anchor.closest("header, nav, aside, [role='navigation'], [role='menubar'], [role='menu']") !== null;
}

export function isLikelyBreadcrumbTabNavigation(anchor: NavigableLinkElement): boolean {
  return anchor.closest(
    "[aria-label*='breadcrumb' i], .breadcrumb, [class*='breadcrumb' i], [role='tablist'], [role='tab']",
  ) !== null;
}

export function isLikelyListDetailNavigation(anchor: NavigableLinkElement): boolean {
  const container = anchor.closest(
    "article, li, [role='listitem'], [class*='card' i], [class*='result' i], [class*='feed' i], [class*='list-item' i]",
  );
  return container !== null && LIST_DETAIL_HINTS.test(`${getElementHints(anchor)} ${getElementHints(container)}`);
}

export function isLikelyContentSequenceNavigation(anchor: NavigableLinkElement): boolean {
  const hints = getElementHints(anchor);
  if (CONTENT_SEQUENCE_HINTS.test(hints)) {
    return true;
  }

  return (
    /\b(?:prev|next)\b/i.test(anchor.rel) &&
    anchor.closest("article, main, [class*='article' i], [class*='chapter' i], [class*='content' i]") !== null &&
    anchor.closest(PAGINATION_CONTAINER_SELECTORS) === null
  );
}

export function isLikelySearchFilterNavigation(anchor: NavigableLinkElement, targetUrl: string): boolean {
  const parsed = parseUrl(targetUrl);
  const queryKeys = parsed === null ? [] : [...parsed.searchParams.keys()];
  return (
    SEARCH_HINTS.test(getElementHints(anchor)) ||
    queryKeys.some((key) => SEARCH_HINTS.test(key)) ||
    anchor.closest("[role='search'], form[role='search'], [class*='filter' i], [class*='search' i]") !== null
  );
}

export function isLikelyDocumentUrl(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl);
  return parsed !== null && DOCUMENT_PATH_HINTS.test(`${parsed.pathname}${parsed.search}`);
}

export function isLikelyMediaUrl(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl);
  return parsed !== null && MEDIA_PATH_HINTS.test(`${parsed.pathname}${parsed.search}`);
}

export function isLikelySpaRoute(
  anchor: NavigableLinkElement,
  currentUrl: string,
  targetUrl: string,
): boolean {
  const current = parseUrl(currentUrl);
  const target = parseUrl(targetUrl);
  if (current === null || target === null || current.origin !== target.origin) {
    return false;
  }

  const explicitHint =
    anchor.hasAttribute("data-router-link") ||
    anchor.hasAttribute("data-route") ||
    anchor.getAttribute("role") === "tab";
  const hashRoute = target.hash.length > 1 && /^#(?:!|\/)/.test(target.hash);
  return explicitHint || hashRoute;
}

export function isLikelySearchForm(form: HTMLFormElement): boolean {
  if (form.matches?.("[role='search'], [class*='search' i], [class*='filter' i]")) {
    return true;
  }

  const hints = [form.id, form.className, form.getAttribute?.("aria-label") ?? ""].join(" ");
  if (SEARCH_HINTS.test(hints)) {
    return true;
  }

  return (form.querySelector?.(
    "input[type='search'], input[name*='search' i], input[name='q'], input[name*='query' i], input[name*='keyword' i]",
  ) ?? null) !== null;
}

function getElementHints(anchor: Element): string {
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

function getContextHints(anchor: NavigableLinkElement): string {
  const elements = [anchor, anchor.parentElement, anchor.closest("nav, [data-testid], [aria-label], [title], [role]")]
    .filter((value): value is Element => value instanceof Element);

  return elements
    .map((element) =>
      [
        element.getAttribute("aria-label") ?? "",
        element.getAttribute("title") ?? "",
        element.getAttribute("data-testid") ?? "",
        element.id,
        element.className,
      ].join(" "),
    )
    .join(" ")
    .trim();
}

function hasPaginationArrowIcon(anchor: NavigableLinkElement): boolean {
  return anchor.querySelector("svg") !== null || /^[<>«»‹›]+$/.test(normalizeText(anchor.textContent ?? ""));
}

function isPaginationText(text: string): boolean {
  return /^\d{1,4}$/.test(text) || /^(?:上一页|下一页|前一页|后一页|首页|尾页|prev|next|previous|first|last|[<>«»‹›]+)$/i.test(text);
}

function isPaginationUrl(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl);
  if (parsed === null) {
    return false;
  }

  const paginationQueryKeys = new Set([
    "page",
    "p",
    "pg",
    "pn",
    "pageno",
    "pagenum",
    "pageindex",
    "paged",
    "start",
    "offset",
  ]);
  const hasPaginationQuery = [...parsed.searchParams.entries()].some(
    ([key, value]) => paginationQueryKeys.has(key.toLowerCase()) && /^\d+$/.test(value.trim()),
  );

  if (hasPaginationQuery || /\/page\/\d+(?:\/|$)/i.test(parsed.pathname)) {
    return true;
  }

  // 兼容静态生成器和早期论坛常见的 list_2.htm、forum-2-1.html 一类翻页地址。
  const filename = parsed.pathname.split("/").pop() ?? "";
  return /^(?:list|index|page|forum|forumdisplay|thread|topic)[_-]\d+(?:[-_]\d+)*\.(?:s?html?|php|asp|aspx|jsp)$/i.test(
    filename,
  );
}

function isNavigationContainer(anchor: NavigableLinkElement): boolean {
  return anchor.closest("nav, [role='navigation']") !== null;
}

function isDirectImageUrl(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl);
  return parsed !== null && DIRECT_IMAGE_PATH_HINTS.test(parsed.pathname);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
