import {
  classifyWindowOpen,
  resolveNavigationDecision,
} from "../lib/navigation";
import type {
  BridgeWindowOpenMessage,
  PageBridgeConfig,
} from "../lib/types";

(() => {
  const config = readBridgeConfig();
  if (config === null) {
    return;
  }

  const originalOpen = window.open.bind(window);
  const patchedFlag = "__pagelinkmode_open_patched__";

  if ((window as typeof window & Record<string, boolean>)[patchedFlag]) {
    return;
  }

  (window as typeof window & Record<string, boolean>)[patchedFlag] = true;

  window.open = function patchedWindowOpen(
    url?: string | URL,
    target?: string,
    features?: string,
  ): Window | null {
    if (!url) {
      return originalOpen(url, target, features);
    }

    const resolvedUrl = resolveTargetUrl(url);
    if (!resolvedUrl || !/^https?:$/.test(resolvedUrl.protocol)) {
      return originalOpen(url, target, features);
    }

    const decision = resolveNavigationDecision(
      classifyWindowOpen(resolvedUrl, target, features),
      config,
    );
    console.debug("[PageLinkMode] window.open", {
      url: resolvedUrl.toString(),
      target,
      features,
      category: decision.category,
      disposition: decision.disposition,
      resolvedBy: decision.resolvedBy,
      reason: decision.reason,
    });
    postWindowOpenDecision(resolvedUrl.toString(), decision);

    if (decision.disposition === "preserve-native") {
      return originalOpen(url, target, features);
    }

    if (decision.disposition === "same-tab") {
      window.location.assign(resolvedUrl.toString());
      return window;
    }

    return null;
  };
})();

function readBridgeConfig(): PageBridgeConfig | null {
  const currentScript = document.currentScript as HTMLScriptElement | null;
  const rawConfig = currentScript?.dataset.config;
  if (!rawConfig) {
    return null;
  }

  try {
    return JSON.parse(rawConfig) as PageBridgeConfig;
  } catch {
    return null;
  }
}

function postWindowOpenDecision(
  url: string,
  decision: ReturnType<typeof resolveNavigationDecision>,
): void {
  const message: BridgeWindowOpenMessage = {
    source: "pagelinkmode-bridge",
    type: "window-open",
    url,
    category: decision.category,
    disposition: decision.disposition,
    resolvedBy: decision.resolvedBy,
    reason: decision.reason,
  };
  window.postMessage(message, window.location.origin);
}

function resolveTargetUrl(url: string | URL): URL | null {
  try {
    return new URL(url.toString(), window.location.href);
  } catch {
    return null;
  }
}
