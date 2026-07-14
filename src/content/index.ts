import type { RuntimeRequest, RuntimeResponse } from "../lib/messages";
import type {
  BridgeWindowOpenMessage,
  NavigableLinkElement,
  NavigationDecision,
  NavigationFacts,
  PageBridgeConfig,
  ResolvedContext,
} from "../lib/types";
import { sendRuntimeMessageBestEffort } from "../lib/runtime-messaging";
import {
  acceptReportedWindowOpenOutcome,
  applyNavigationExecutionOutcome,
  classifyAnchorNavigation,
  classifyFormNavigation,
  resolveNavigationDecision,
} from "../lib/navigation";
import { isHashOnlyNavigation, isSupportedPageUrl } from "../lib/url";
import { getNavigableHref } from "../lib/navigable-link";
import { getClosestAnchor, getSubmitForm } from "./dom";
import {
  isAnchorNavigationAlreadyObserved,
  markAnchorNavigationObserved,
  takeOverAnchorNavigation,
} from "./anchor-events";
import { overrideFormTargetForNativeSubmission, shouldSkipFormNavigationEvent } from "./forms";

type ContentRuntimeScope = typeof globalThis & { __PAGELINKMODE_CONTENT_INITIALIZED__?: boolean };

let currentContext: ResolvedContext | null = null;
let currentBridgeToken = "";
let hasActiveBindings = false;
const runtimeScope = globalThis as ContentRuntimeScope;

if (!runtimeScope.__PAGELINKMODE_CONTENT_INITIALIZED__) {
  runtimeScope.__PAGELINKMODE_CONTENT_INITIALIZED__ = true;
  void initializeContentScript().catch((error) => console.error("[PageLinkMode] content script 初始化失败", error));
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
}

async function initializeContentScript(): Promise<void> {
  const contextUrl = resolveContextUrl();
  const context = await chrome.runtime.sendMessage({ type: "plm:get-context", url: contextUrl } as RuntimeRequest) as ResolvedContext;
  applyRuntimeContext(context);
  if (window === window.top) await updateManagedBadge(context.siteEnabled);
}

function applyRuntimeContext(context: ResolvedContext): void {
  currentContext = context;
  if (context.siteEnabled) ensureActiveBindings();
  if (currentBridgeToken) configurePageBridge(context, currentBridgeToken);
}

function ensureActiveBindings(): void {
  if (hasActiveBindings) return;
  hasActiveBindings = true;
  currentBridgeToken = createBridgeToken();
  window.addEventListener("message", onBridgeMessage);
  window.addEventListener("click", onWindowClickCapture, true);
  window.addEventListener("click", onWindowClickBubble);
  window.addEventListener("auxclick", onWindowAuxClick, true);
  window.addEventListener("submit", onWindowSubmit);
}

function configurePageBridge(context: ResolvedContext, bridgeToken: string): void {
  const config: PageBridgeConfig = {
    siteEnabled: context.siteEnabled,
    pageMode: context.pageMode,
    siteMode: context.siteMode,
    globalCategoryRules: context.globalCategoryRules,
    siteCategoryRules: context.siteCategoryRules,
    personalRules: context.personalRules,
    riskGrant: context.riskGrant,
    bridgeToken,
    pageUrl: context.url,
  };
  window.postMessage({ source: "pagelinkmode-content", type: "bridge-config", config }, getPostMessageTargetOrigin());
}

function onRuntimeMessage(
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean | void {
  const request = message as RuntimeRequest;
  if (request.type === "plm:ping-content") {
    sendResponse({ ok: true });
    return;
  }
  if (request.type === "plm:update-context") {
    applyRuntimeContext(request.context);
    if (window === window.top) void updateManagedBadge(request.context.siteEnabled);
    sendResponse({ ok: true });
    return;
  }
  if (request.type !== "plm:refresh-context") return;
  void refreshRuntimeContext()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
  return true;
}

async function refreshRuntimeContext(): Promise<void> {
  const context = await chrome.runtime.sendMessage({ type: "plm:get-context", url: resolveContextUrl() } as RuntimeRequest) as ResolvedContext;
  applyRuntimeContext(context);
  if (window === window.top) await updateManagedBadge(context.siteEnabled);
}

async function updateManagedBadge(managed: boolean): Promise<void> {
  await chrome.runtime.sendMessage({ type: "plm:set-badge", payload: { managed } } as RuntimeRequest);
}

function onBridgeMessage(event: MessageEvent<BridgeWindowOpenMessage>): void {
  if (
    event.source !== window || event.data?.source !== "pagelinkmode-bridge" ||
    event.data.bridgeToken !== currentBridgeToken
  ) return;
  if (!currentContext) return;
  // MAIN world 与网页共享执行环境，回传结果只能作为事件通知，实际决策必须在隔离世界重算。
  const expected = resolveNavigationDecision(event.data.facts, currentContext);
  recordDecision(event.data.facts, acceptReportedWindowOpenOutcome(expected, event.data.decision));
}

function onWindowClickCapture(event: MouseEvent): void {
  handleAnchorEvent(event, true);
}

function onWindowClickBubble(event: MouseEvent): void {
  handleAnchorEvent(event, false);
}

function onWindowAuxClick(event: MouseEvent): void {
  if (event.button === 1) handleAnchorEvent(event, true);
}

function handleAnchorEvent(event: MouseEvent, capture: boolean): void {
  if (!currentContext || event.isTrusted === false || isAnchorNavigationAlreadyObserved(event)) return;
  if (!capture && event.defaultPrevented) return;
  const anchor = resolveNavigableAnchor(event);
  if (!anchor) return;

  const userIntent = event.button === 1
    ? "middle"
    : event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      ? "modified"
      : "plain";
  const facts = classifyAnchorNavigation(anchor, window.location.href, {
    userIntent,
    documentBaseTarget: anchor.ownerDocument?.querySelector<HTMLBaseElement>("base[target]")?.target ?? "",
  });
  const decision = resolveNavigationDecision(facts, currentContext);
  markAnchorNavigationObserved(event);

  if (!decision.applied || !capture) {
    recordDecision(facts, decision);
    return;
  }
  takeOverAnchorNavigation(event);
  void navigateAnchor(facts.targetUrl, decision).then((actualDecision) => {
    recordDecision(facts, actualDecision);
  });
}

function onWindowSubmit(event: SubmitEvent): void {
  if (!currentContext || shouldSkipFormNavigationEvent(event)) return;
  const form = getSubmitForm(event.target);
  if (!form) return;
  const facts = classifyFormNavigation(form, event.submitter, window.location.href, { userIntent: "plain" });
  const decision = resolveNavigationDecision(facts, currentContext);
  if (decision.applied && (decision.disposition === "same-tab" || decision.disposition === "new-tab")) {
    overrideFormTargetForNativeSubmission(form, event.submitter, decision.disposition);
  }
  queueMicrotask(() => {
    const actualDecision = decision.applied && event.defaultPrevented
      ? applyNavigationExecutionOutcome(decision, {
        applied: false,
        disposition: decision.nativeDisposition,
        bypassReason: "page-prevented",
      })
      : decision;
    recordDecision(facts, actualDecision);
  });
}

function resolveNavigableAnchor(event: MouseEvent): NavigableLinkElement | null {
  const anchor = getClosestAnchor(event.target, event.composedPath());
  if (!anchor) return null;
  const href = getNavigableHref(anchor);
  if (!href || /^javascript:/i.test(href)) return null;
  if (isHashOnlyNavigation(window.location.href, href) && !isLikelyHashRoute(anchor, href)) return null;
  return anchor;
}

async function navigateAnchor(href: string, decision: NavigationDecision): Promise<NavigationDecision> {
  if (decision.disposition === "same-tab") {
    try {
      window.location.assign(href);
      return decision;
    } catch {
      return applyNavigationExecutionOutcome(decision, {
        applied: false,
        disposition: decision.nativeDisposition,
        bypassReason: "same-tab-navigation-failed",
      });
    }
  }
  if (decision.disposition !== "new-tab") return decision;
  const opened = window.open(href, "_blank");
  if (opened !== null) {
    try { opened.opener = null; } catch { /* 跨进程窗口可能禁止写 opener。 */ }
    return decision;
  }
  if (await openUrlInBackground(href)) return decision;
  try {
    window.location.assign(href);
    return applyNavigationExecutionOutcome(decision, {
      applied: false,
      disposition: "same-tab",
      bypassReason: "new-tab-fallback-current-tab",
    });
  } catch {
    return applyNavigationExecutionOutcome(decision, {
      applied: false,
      disposition: decision.nativeDisposition,
      bypassReason: "new-tab-navigation-failed",
    });
  }
}

async function openUrlInBackground(href: string): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "plm:open-url", url: href, mode: "new-tab" } as RuntimeRequest) as RuntimeResponse;
    if (typeof response === "object" && response !== null && "ok" in response && !response.ok) throw new Error(response.error);
    return true;
  } catch (error) {
    console.error("[PageLinkMode] 后台新标签导航失败，回退当前页", error);
    return false;
  }
}

function recordDecision(facts: NavigationFacts, decision: NavigationDecision): void {
  if (!currentContext) return;
  void sendRuntimeMessageBestEffort(
    (message) => chrome.runtime.sendMessage(message),
    {
      type: "plm:append-debug-record",
      record: {
        pageUrl: currentContext.url,
        targetUrl: facts.targetUrl,
        trigger: facts.trigger,
        category: decision.category,
        requestedDisposition: decision.requestedDisposition,
        nativeDisposition: decision.nativeDisposition,
        disposition: decision.disposition,
        applied: decision.applied,
        bypassReason: decision.bypassReason,
        resolvedBy: decision.resolvedBy,
        winningRuleId: decision.winningRuleId,
        evidence: facts.evidence,
        reason: decision.reason,
      },
    } as RuntimeRequest,
  );
}

function isLikelyHashRoute(anchor: NavigableLinkElement, targetUrl: string): boolean {
  const target = new URL(targetUrl);
  if (!target.hash) return false;
  let fragment = target.hash.slice(1);
  try { fragment = decodeURIComponent(fragment); } catch { return false; }
  const hasDocumentTarget = document.getElementById(fragment) !== null || document.getElementsByName(fragment).length > 0;
  if (hasDocumentTarget) return false;
  return /^#(?:!|\/)/.test(target.hash) || anchor.closest("nav, [role='tablist'], [data-router]") !== null;
}

function resolveContextUrl(): string {
  const candidates = [window.location.href, document.baseURI];
  try { if (window.parent !== window) candidates.push(window.parent.location.href); } catch { /* 跨源父 frame 不可读。 */ }
  return candidates.find((candidate) => isSupportedPageUrl(candidate)) ?? window.location.href;
}

function createBridgeToken(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, "0")).join("");
}

function getPostMessageTargetOrigin(): string { return window.location.origin === "null" ? "*" : window.location.origin; }

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "刷新页面规则失败。";
}
