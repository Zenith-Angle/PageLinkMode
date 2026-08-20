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
// Discourse uses ordinary anchors for both content entries and local timeline/facet navigation.
// Keep these signals narrow so topic titles remain list-detail links while the forum's own
// category, tag and post-position controls stay in the current browsing context.
const DISCOURSE_FORUM_FACET_SELECTORS = [
  ".topic-list-item .badge-category__wrapper",
  ".topic-list-item .discourse-tag",
].join(", ");
const DISCOURSE_FORUM_NAVIGATION_SELECTORS = [
  ".timeline-date-wrapper .start-date",
  ".timeline-date-wrapper .now-date",
  ".topic-post .post-date",
  ".timeline-container .fancy-title",
  ".timeline-container .topic-link",
].join(", ");
const DISCOURSE_LOCAL_NAVIGATION_SELECTORS = [
  DISCOURSE_FORUM_FACET_SELECTORS,
  DISCOURSE_FORUM_NAVIGATION_SELECTORS,
].join(", ");
const DISCOURSE_QUOTE_CONTROL_SELECTORS = ".quote-controls";
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
const FRONTEND_ACTION_HINTS = /(?:收藏|取消收藏|加入收藏|移出收藏|添加收藏|移除收藏|点赞|取消点赞|关注|取消关注|订阅|取消订阅|bookmark|favorite|like|follow|subscribe)/i;
const FRONTEND_ACTION_TEXT = /^(?:收藏|取消收藏|加入收藏|移出收藏|添加收藏|移除收藏|点赞|取消点赞|关注|取消关注|订阅|取消订阅|bookmark(?:ed)?|favorite|favourite|like(?:d)?|follow(?:ing)?|subscribe(?:d)?)$/i;
const FRONTEND_ACTION_ATTRIBUTE_NAMES = [
  "data-action",
  "data-action-type",
  "data-actionname",
  "data-command",
  "data-command-name",
  "data-cmd",
  "data-intent",
  "data-operation",
  "data-operation-type",
  "data-toggle",
  "data-toggle-action",
  "data-click-action",
  "data-event-action",
] as const;
const FRONTEND_ACTION_CONTROL_HINTS = /(?:button|btn|action|toggle|control|trigger|icon|link)/i;
const COLLECTION_PAGE_HINTS = /(?:我的收藏|收藏(?:列表|夹|页|页面|内容)|(?:bookmarks?|favorites?|likes?|following|followers?|subscriptions?)\s*(?:list|page|items?|posts?|feed|activity))/i;
const COLLECTION_PATH_HINTS = /(?:^|\/)(?:bookmarks?|favorites?|likes?|following|followers?|subscriptions?|saved)(?:\/|$)/i;
const ARIA_ACTION_ATTRIBUTES = ["aria-pressed", "aria-expanded", "aria-haspopup"] as const;

/**
 * 识别会由网页脚本消费的动作控件；只对明确的 ARIA/动作属性或动作文案命中，普通内容链接保持可接管。
 * 返回稳定信号供能力门禁和调试证据使用，收藏/点赞列表页等纯浏览入口会被排除。
 */
export function getFrontendActionControlSignal(
  anchor: NavigableLinkElement,
  targetUrl: string,
): string | null {
  if (anchor.closest(DISCOURSE_QUOTE_CONTROL_SELECTORS) !== null) {
    return "discourse-quote-control";
  }

  const role = readAttribute(anchor, "role")?.trim().toLowerCase() ?? "";
  if (role.split(/\s+/).includes("button")) {
    return "role=button";
  }

  for (const attribute of ARIA_ACTION_ATTRIBUTES) {
    if (anchor.hasAttribute(attribute)) {
      return attribute;
    }
  }

  for (const attribute of FRONTEND_ACTION_ATTRIBUTE_NAMES) {
    if (anchor.hasAttribute(attribute)) {
      return `attribute:${attribute}`;
    }
  }

  if (isCollectionPageNavigation(anchor, targetUrl)) {
    return null;
  }

  // 可访问名称和 title 是用户可见的动作提示；class/id/testid 还必须带控件词，避免 favorite-card 一类内容容器误判。
  const directLabelSources = [
    readAttribute(anchor, "aria-label"),
    readAttribute(anchor, "title"),
  ].filter((value): value is string => value !== null && value.trim().length > 0);
  for (const value of directLabelSources) {
    const match = value.match(FRONTEND_ACTION_HINTS);
    if (match) {
      return `label:${match[0].toLowerCase()}`;
    }
  }

  const metadataLabelSources = [
    readAttribute(anchor, "id"),
    readAttribute(anchor, "class"),
    readAttribute(anchor, "data-testid"),
  ].filter((value): value is string => value !== null && value.trim().length > 0);
  for (const value of metadataLabelSources) {
    const match = value.match(FRONTEND_ACTION_HINTS);
    if (match && (FRONTEND_ACTION_CONTROL_HINTS.test(value) || FRONTEND_ACTION_TEXT.test(value.trim()))) {
      return `label:${match[0].toLowerCase()}`;
    }
  }

  const text = normalizeText(anchor.textContent ?? "");
  const textMatch = text.match(FRONTEND_ACTION_HINTS);
  if (textMatch && FRONTEND_ACTION_TEXT.test(text)) {
    return `text:${textMatch[0].toLowerCase()}`;
  }

  return null;
}

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
    `[aria-label*='breadcrumb' i], .breadcrumb, [class*='breadcrumb' i], [role='tablist'], [role='tab'], ${DISCOURSE_LOCAL_NAVIGATION_SELECTORS}`,
  ) !== null;
}

export function isLikelyForumFacetNavigation(anchor: NavigableLinkElement): boolean {
  return anchor.closest(DISCOURSE_FORUM_FACET_SELECTORS) !== null;
}

export function isLikelyForumNavigation(anchor: NavigableLinkElement): boolean {
  return anchor.closest(DISCOURSE_FORUM_NAVIGATION_SELECTORS) !== null;
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

function isCollectionPageNavigation(anchor: NavigableLinkElement, targetUrl: string): boolean {
  const elementHints = [
    readAttribute(anchor, "aria-label"),
    readAttribute(anchor, "title"),
    readAttribute(anchor, "id"),
    readAttribute(anchor, "class"),
    readAttribute(anchor, "data-testid"),
    anchor.textContent ?? "",
  ].filter((value): value is string => value !== null && value.trim().length > 0).join(" ");
  if (COLLECTION_PAGE_HINTS.test(elementHints)) {
    return true;
  }

  const parsed = parseUrl(targetUrl);
  if (parsed === null) return false;
  return COLLECTION_PATH_HINTS.test(parsed.pathname);
}

function readAttribute(element: Element, name: string): string | null {
  try {
    return element.getAttribute(name);
  } catch {
    return null;
  }
}
