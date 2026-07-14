import { classifyWindowOpen, resolveNavigationDecision } from "../lib/navigation";
import type { BridgeWindowOpenMessage, NavigationDecision, PageBridgeConfig } from "../lib/types";

(() => {
  const originalOpen = window.open.bind(window);
  const patchedFlag = "__pagelinkmode_open_patched__";
  let config: PageBridgeConfig | null = null;

  if ((window as typeof window & Record<string, boolean>)[patchedFlag]) return;
  (window as typeof window & Record<string, boolean>)[patchedFlag] = true;

  window.addEventListener("message", (event: MessageEvent<BridgeConfigMessage>) => {
    if (event.source === window && event.data?.source === "pagelinkmode-content" && event.data.type === "bridge-config") {
      config = event.data.config;
    }
  });

  window.open = function patchedWindowOpen(url?: string | URL, target?: string, features?: string): Window | null {
    if (!url || !config) return originalOpen(url, target, features);
    const resolvedUrl = resolveTargetUrl(url);
    if (!resolvedUrl) return originalOpen(url, target, features);

    const userActive = navigator.userActivation?.isActive === true;
    const facts = classifyWindowOpen(resolvedUrl, target, features, config.pageUrl, {
      userIntent: userActive ? "script-active" : "script-passive",
    });
    const decision = resolveNavigationDecision(facts, config);

    if (!decision.applied) {
      const result = originalOpen(url, target, features);
      postWindowOpenDecision(facts, decision, config.bridgeToken);
      return result;
    }

    if (decision.disposition === "same-tab") {
      postWindowOpenDecision(facts, decision, config.bridgeToken);
      window.location.assign(resolvedUrl.toString());
      return window;
    }

    const opened = originalOpen(resolvedUrl.toString(), "_blank", features);
    const actualDecision: NavigationDecision = opened === null
      ? { ...decision, applied: false, disposition: decision.nativeDisposition, bypassReason: "popup-blocked" }
      : decision;
    postWindowOpenDecision(facts, actualDecision, config.bridgeToken);
    return opened;
  };
})();

interface BridgeConfigMessage {
  source: "pagelinkmode-content";
  type: "bridge-config";
  config: PageBridgeConfig;
}

function postWindowOpenDecision(
  facts: ReturnType<typeof classifyWindowOpen>,
  decision: NavigationDecision,
  bridgeToken: string,
): void {
  const message: BridgeWindowOpenMessage = {
    source: "pagelinkmode-bridge",
    type: "window-open",
    bridgeToken,
    facts,
    decision,
  };
  window.postMessage(message, getPostMessageTargetOrigin());
}

function resolveTargetUrl(url: string | URL): URL | null {
  try { return new URL(url.toString(), window.location.href); } catch { return null; }
}

function getPostMessageTargetOrigin(): string { return window.location.origin === "null" ? "*" : window.location.origin; }
