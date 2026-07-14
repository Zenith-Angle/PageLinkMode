import { createDefaultGlobalCategoryRules } from "./navigation-categories";
import type { ExtensionState, PopupContext, ResolvedContext, RiskGrant, RuleMode } from "./types";
import { getHostname, normalizePageUrl } from "./url";

export function resolveContext(
  rawUrl: string,
  state: ExtensionState,
  riskGrant?: RiskGrant,
): ResolvedContext {
  const pageKey = normalizePageUrl(rawUrl);
  const hostname = getHostname(rawUrl).toLowerCase();
  const pageMode = toRuleMode(state.pageRules[pageKey]);
  const siteMode = toRuleMode(state.siteRules[hostname]);
  const siteEnabled = !state.disabledSites.includes(hostname);
  const personalRules = state.personalRules.filter((rule) =>
    rule.scope.hostname.toLowerCase() === hostname &&
    (rule.scope.type === "site" || rule.scope.pageKey === pageKey),
  );
  const effectiveSource = !siteEnabled
    ? "disabled"
    : pageMode !== "inherit"
      ? "page"
      : siteMode !== "inherit"
        ? "site"
        : "category";
  const effectiveMode = effectiveSource === "page"
    ? pageMode
    : effectiveSource === "site"
      ? siteMode
      : "preserve-native";

  return {
    url: rawUrl,
    hostname,
    pageKey,
    siteEnabled,
    pageMode,
    siteMode,
    globalCategoryRules: state.globalCategoryRules,
    siteCategoryRules: state.siteCategoryRules[hostname] ?? {},
    // 页面运行时只接收当前站点和当前页面可能命中的规则，避免跨站配置进入网页主世界。
    personalRules,
    ...(riskGrant?.hostname === hostname ? { riskGrant } : {}),
    effectiveMode: effectiveMode === "inherit" ? "preserve-native" : effectiveMode,
    effectiveSource,
  };
}

export function buildUnsupportedPopupContext(rawUrl: string): PopupContext {
  return {
    url: rawUrl,
    hostname: "",
    pageKey: rawUrl,
    siteEnabled: false,
    pageMode: "inherit",
    siteMode: "inherit",
    globalCategoryRules: createDefaultGlobalCategoryRules(),
    siteCategoryRules: {},
    personalRules: [],
    effectiveMode: "preserve-native",
    effectiveSource: "disabled",
    supported: false,
    siteAuthorizationRecorded: false,
  };
}

function toRuleMode(value?: ResolvedContext["effectiveMode"]): RuleMode {
  return value ?? "inherit";
}
