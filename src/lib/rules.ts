import type { ExtensionState, PopupContext, ResolvedContext, RuleMode } from "./types";
import { getHostname, normalizePageUrl } from "./url";

export function resolveContext(rawUrl: string, state: ExtensionState): ResolvedContext {
  const pageKey = normalizePageUrl(rawUrl);
  const hostname = getHostname(rawUrl);
  const pageMode = toRuleMode(state.pageRules[pageKey]);
  const siteMode = toRuleMode(state.siteRules[hostname]);

  if (pageMode !== "inherit") {
    return buildContext(rawUrl, hostname, pageKey, state.globalMode, siteMode, pageMode, "page");
  }

  if (siteMode !== "inherit") {
    return buildContext(rawUrl, hostname, pageKey, state.globalMode, siteMode, pageMode, "site");
  }

  return buildContext(
    rawUrl,
    hostname,
    pageKey,
    state.globalMode,
    siteMode,
    pageMode,
    "global",
  );
}

function buildContext(
  url: string,
  hostname: string,
  pageKey: string,
  globalMode: ResolvedContext["globalMode"],
  siteMode: RuleMode,
  pageMode: RuleMode,
  effectiveSource: ResolvedContext["effectiveSource"],
): ResolvedContext {
  const effectiveMode =
    effectiveSource === "page"
      ? ensureMode(pageMode, globalMode)
      : effectiveSource === "site"
        ? ensureMode(siteMode, globalMode)
        : globalMode;

  return {
    url,
    hostname,
    pageKey,
    globalMode,
    siteMode,
    pageMode,
    effectiveMode,
    effectiveSource,
  };
}

function toRuleMode(value?: ResolvedContext["effectiveMode"]): RuleMode {
  return value ?? "inherit";
}

function ensureMode(mode: RuleMode, fallback: ResolvedContext["effectiveMode"]) {
  return mode === "inherit" ? fallback : mode;
}

export function buildUnsupportedPopupContext(rawUrl: string): PopupContext {
  return {
    url: rawUrl,
    hostname: "",
    pageKey: rawUrl,
    globalMode: "same-tab",
    siteMode: "inherit",
    pageMode: "inherit",
    effectiveMode: "same-tab",
    effectiveSource: "global",
    supported: false,
    siteAuthorizationRecorded: false,
  };
}
