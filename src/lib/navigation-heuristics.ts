import { parseUrl } from "./url";

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

export function isLikelyPaginationNavigation(
  anchor: HTMLAnchorElement,
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
  anchor: HTMLAnchorElement,
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

function getContextHints(anchor: HTMLAnchorElement): string {
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

function hasPaginationArrowIcon(anchor: HTMLAnchorElement): boolean {
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

  return (
    /(?:^|[?&#])(?:page|p|pn|pageno|pageNo|pageNum|pageIndex|paged)=\d+/i.test(parsed.search) ||
    /\/page\/\d+(?:\/|$)/i.test(parsed.pathname)
  );
}

function isNavigationContainer(anchor: HTMLAnchorElement): boolean {
  return anchor.closest("nav, [role='navigation']") !== null;
}

function isDirectImageUrl(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl);
  return parsed !== null && DIRECT_IMAGE_PATH_HINTS.test(parsed.pathname);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
