import type { RuntimeRequest } from "../lib/messages";
import type { BridgeWindowOpenMessage, NavigationMode, ResolvedContext } from "../lib/types";
import {
  classifyAnchorNavigation,
  classifyFormNavigation,
} from "../lib/navigation";
import { isHashOnlyNavigation, isSkippableHref, isSupportedPageUrl } from "../lib/url";
import { getClosestAnchor, getSubmitForm, hasPointerModifier } from "./dom";
import { submitFormInCurrentTab, submitFormInNewTab } from "./forms";

let currentContext: ResolvedContext | null = null;

void initializeContentScript();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if ((message as RuntimeRequest).type !== "plm:ping-content") {
    return;
  }

  sendResponse({ ok: true });
});

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

  injectPageBridge(currentContext.effectiveMode);
  window.addEventListener("message", onBridgeMessage);
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("submit", onDocumentSubmit, true);
}

function injectPageBridge(mode: NavigationMode): void {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("js/page-bridge.js");
  script.dataset.mode = mode;
  script.dataset.source = "pagelinkmode";
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

  void chrome.runtime.sendMessage({
    type: "plm:open-url",
    url: event.data.url,
    mode: "new-tab",
  } as RuntimeRequest);
}

function onDocumentClick(event: MouseEvent): void {
  if (currentContext === null || hasPointerModifier(event)) {
    return;
  }

  const anchor = getClosestAnchor(event.target);
  if (!anchor || anchor.hasAttribute("download")) {
    return;
  }

  const href = anchor.href;
  if (!href || isSkippableHref(href) || !isSupportedPageUrl(href)) {
    return;
  }

  if (isHashOnlyNavigation(window.location.href, href)) {
    return;
  }

  const decision = classifyAnchorNavigation(anchor, window.location.href, currentContext.effectiveMode);
  console.debug("[PageLinkMode] anchor navigation", {
    href,
    disposition: decision.disposition,
    reason: decision.reason,
  });

  if (decision.disposition === "preserve-native") {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  void chrome.runtime.sendMessage({
    type: "plm:open-url",
    url: href,
    mode: decision.disposition,
  } as RuntimeRequest);
}

function onDocumentSubmit(event: SubmitEvent): void {
  if (currentContext === null) {
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

  const decision = classifyFormNavigation(form, window.location.href, currentContext.effectiveMode);
  console.debug("[PageLinkMode] form navigation", {
    actionUrl,
    method: (form.method || "get").toUpperCase(),
    disposition: decision.disposition,
    reason: decision.reason,
  });

  if (decision.disposition === "preserve-native") {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  if (decision.disposition === "same-tab") {
    submitFormInCurrentTab(form);
    return;
  }

  submitFormInNewTab(form);
}
