import type { RuntimeRequest } from "../lib/messages";
import type {
  BridgeWindowOpenMessage,
  NavigationDebugRecordInput,
  ResolvedContext,
} from "../lib/types";
import {
  classifyAnchorNavigation,
  classifyFormNavigation,
  resolveNavigationDecision,
} from "../lib/navigation";
import { isHashOnlyNavigation, isSkippableHref, isSupportedPageUrl } from "../lib/url";
import {
  getClosestAnchor,
  getSubmitForm,
  isPageHandledNavigationEvent,
} from "./dom";
import {
  shouldSkipAnchorNavigationEvent,
  shouldTakeOverAnchorNavigation,
  takeOverAnchorNavigation,
} from "./anchor-events";
import { submitFormInCurrentTab, submitFormInNewTab } from "./forms";

type ContentRuntimeScope = typeof globalThis & {
  __PAGELINKMODE_CONTENT_INITIALIZED__?: boolean;
};

let currentContext: ResolvedContext | null = null;
const runtimeScope = globalThis as ContentRuntimeScope;

if (!runtimeScope.__PAGELINKMODE_CONTENT_INITIALIZED__) {
  // 后台在恢复旧标签页时可能会主动补注入脚本，这里用运行时标记保证初始化幂等。
  runtimeScope.__PAGELINKMODE_CONTENT_INITIALIZED__ = true;
  void initializeContentScript().catch((error) => {
    console.error("[PageLinkMode] content script 初始化失败", error);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if ((message as RuntimeRequest).type !== "plm:ping-content") {
      return;
    }

    sendResponse({ ok: true });
  });
}

async function initializeContentScript(): Promise<void> {
  currentContext = (await chrome.runtime.sendMessage({
    type: "plm:get-context",
    url: window.location.href,
  } as RuntimeRequest)) as ResolvedContext;

  await chrome.runtime.sendMessage({
    type: "plm:set-badge",
    payload: {
      mode: currentContext.effectiveMode,
      source: currentContext.effectiveSource,
    },
  } as RuntimeRequest);

  if (!currentContext.siteEnabled) {
    return;
  }

  injectPageBridge(currentContext);
  window.addEventListener("message", onBridgeMessage);
  window.addEventListener("click", onWindowClickCapture, true);
  window.addEventListener("click", onWindowClick);
  window.addEventListener("submit", onWindowSubmit);
}

function injectPageBridge(context: ResolvedContext): void {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("js/page-bridge.js");
  script.dataset.source = "pagelinkmode";
  script.dataset.config = JSON.stringify({
    siteEnabled: context.siteEnabled,
    pageMode: context.pageMode,
    siteMode: context.siteMode,
    globalCategoryRules: context.globalCategoryRules,
    siteCategoryRules: context.siteCategoryRules,
  });
  script.async = false;
  (document.head ?? document.documentElement).appendChild(script);
  script.remove();
}

function onBridgeMessage(event: MessageEvent<BridgeWindowOpenMessage>): void {
  if (event.source !== window || event.data?.source !== "pagelinkmode-bridge") {
    return;
  }

  if (!isSupportedPageUrl(event.data.url)) {
    return;
  }

  recordDecision({
    trigger: "window.open",
    targetUrl: event.data.url,
    category: event.data.category,
    disposition: event.data.disposition,
    resolvedBy: event.data.resolvedBy,
    reason: event.data.reason,
  });

  if (event.data.disposition !== "new-tab") {
    return;
  }

  void chrome.runtime.sendMessage({
    type: "plm:open-url",
    url: event.data.url,
    mode: "new-tab",
  } as RuntimeRequest);
}

function onWindowClickCapture(event: MouseEvent): void {
  if (shouldSkipAnchorNavigationEvent(event, currentContext !== null)) {
    return;
  }

  const anchor = resolveNavigableAnchor(event);
  if (!anchor) {
    return;
  }

  // Discourse 这类 SPA 会在 bubbling 阶段把普通链接改成站内路由。
  // 在 capture 阶段先处理标准锚点，才能保留扩展对“正常内容链接”的接管能力。
  handleAnchorNavigation(anchor, event);
}

function onWindowClick(event: MouseEvent): void {
  if (shouldSkipAnchorNavigationEvent(event, currentContext !== null)) {
    return;
  }

  const anchor = resolveNavigableAnchor(event);
  if (!anchor) {
    return;
  }

  handleAnchorNavigation(anchor, event);
}

function onWindowSubmit(event: SubmitEvent): void {
  if (currentContext === null || isPageHandledNavigationEvent(event)) {
    return;
  }

  const form = getSubmitForm(event.target);
  if (!form || form.method.toLowerCase() === "dialog") {
    return;
  }

  const actionUrl = form.action || window.location.href;
  if (!isSupportedPageUrl(actionUrl)) {
    return;
  }

  if (typeof form.reportValidity === "function" && !form.reportValidity()) {
    return;
  }

  const decision = resolveNavigationDecision(classifyFormNavigation(form), currentContext);
  console.debug("[PageLinkMode] form navigation", {
    actionUrl,
    method: (form.method || "get").toUpperCase(),
    category: decision.category,
    disposition: decision.disposition,
    resolvedBy: decision.resolvedBy,
    reason: decision.reason,
  });
  recordDecision({
    trigger: "form",
    targetUrl: actionUrl,
    category: decision.category,
    disposition: decision.disposition,
    resolvedBy: decision.resolvedBy,
    reason: decision.reason,
  });

  if (decision.disposition === "preserve-native") {
    return;
  }

  event.preventDefault();

  if (decision.disposition === "same-tab") {
    submitFormInCurrentTab(form);
    return;
  }

  submitFormInNewTab(form);
}

function resolveNavigableAnchor(event: MouseEvent): HTMLAnchorElement | null {
  const anchor = getClosestAnchor(event.target);
  if (!anchor || anchor.hasAttribute("download")) {
    return null;
  }

  const href = anchor.href;
  if (!href || isSkippableHref(href) || !isSupportedPageUrl(href)) {
    return null;
  }

  if (isHashOnlyNavigation(window.location.href, href)) {
    return null;
  }

  return anchor;
}

function handleAnchorNavigation(anchor: HTMLAnchorElement, event: MouseEvent): void {
  if (currentContext === null) {
    return;
  }

  const href = anchor.href;
  const decision = resolveNavigationDecision(
    classifyAnchorNavigation(anchor, window.location.href),
    currentContext,
  );
  console.debug("[PageLinkMode] anchor navigation", {
    href,
    category: decision.category,
    disposition: decision.disposition,
    resolvedBy: decision.resolvedBy,
    reason: decision.reason,
    phase: event.eventPhase,
  });
  recordDecision({
    trigger: "anchor",
    targetUrl: href,
    category: decision.category,
    disposition: decision.disposition,
    resolvedBy: decision.resolvedBy,
    reason: decision.reason,
  });

  if (decision.disposition === "preserve-native") {
    return;
  }

  if (!shouldTakeOverAnchorNavigation(event, decision.disposition)) {
    return;
  }

  // 命中扩展接管规则后，不仅要取消浏览器默认跳转，
  // 还要同步截断页面后续 click 监听中的脚本导航，避免“双跳转”。
  takeOverAnchorNavigation(event);
  void chrome.runtime.sendMessage({
    type: "plm:open-url",
    url: href,
    mode: decision.disposition,
  } as RuntimeRequest);
}

function recordDecision(
  payload: Omit<NavigationDebugRecordInput, "pageUrl">,
): void {
  if (currentContext === null) {
    return;
  }

  void chrome.runtime.sendMessage({
    type: "plm:append-debug-record",
    record: {
      pageUrl: currentContext.url,
      ...payload,
    },
  } as RuntimeRequest);
}
