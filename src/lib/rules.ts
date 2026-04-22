import { createDefaultGlobalCategoryRules } from "./navigation-categories";
import type { ExtensionState, PopupContext, ResolvedContext, RuleMode } from "./types";
import { getHostname, normalizePageUrl } from "./url";

export function resolveContext(rawUrl: string, state: ExtensionState): ResolvedContext {
  const pageKey = normalizePageUrl(rawUrl);
  const hostname = getHostname(rawUrl);
  const pageMode = toRuleMode(state.pageRules[pageKey]);
  const siteMode = toRuleMode(state.siteRules[hostname]);
  const siteEnabled = !state.disabledSites.includes(hostname);

  if (!siteEnabled) {
    return buildContext(rawUrl, hostname, pageKey, state, siteMode, pageMode, false, "disabled");
  }

  if (pageMode !== "inherit") {
    return buildContext(rawUrl, hostname, pageKey, state, siteMode, pageMode, true, "page");
  }

  if (siteMode !== "inherit") {
    return buildContext(rawUrl, hostname, pageKey, state, siteMode, pageMode, true, "site");
  }

  return buildContext(rawUrl, hostname, pageKey, state, siteMode, pageMode, true, "global");
}

export function buildUnsupportedPopupContext(rawUrl: string): PopupContext {
  return {
    url: rawUrl,
    hostname: "",
    pageKey: rawUrl,
    siteEnabled: true,
    globalMode: "same-tab",
    pageMode: "inherit",
    siteMode: "inherit",
    globalCategoryRules: createDefaultGlobalCategoryRules(),
    siteCategoryRules: {},
    effectiveMode: "same-tab",
    effectiveSource: "global",
    supported: false,
    siteAuthorizationRecorded: false,
  };
}

function buildContext(
  url: string,
  hostname: string,
  pageKey: string,
  state: ExtensionState,
  siteMode: RuleMode,
  pageMode: RuleMode,
  siteEnabled: boolean,
  effectiveSource: ResolvedContext["effectiveSource"],
): ResolvedContext {
  const effectiveMode =
    effectiveSource === "page"
      ? ensureMode(pageMode, state.globalMode)
      : effectiveSource === "site"
        ? ensureMode(siteMode, state.globalMode)
        : state.globalMode;

  return {
    url,
    hostname,
    pageKey,
    siteEnabled,
    globalMode: state.globalMode,
    pageMode,
    siteMode,
    globalCategoryRules: state.globalCategoryRules,
    siteCategoryRules: state.siteCategoryRules[hostname] ?? {},
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
