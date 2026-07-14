import { createDefaultGlobalCategoryRules } from "./navigation-categories";
import type { NavigationDisposition, PopupContext, RuleMode, RuleSource } from "./types";

export function normalizePopupContextResponse(response: unknown): PopupContext {
  if (!isRecord(response)) throw new Error("后台返回了不完整的页面状态。");
  if (response.ok === false) {
    const detail = typeof response.error === "string" ? response.error : "未知错误";
    throw new Error(`读取扩展状态失败：${detail}`);
  }
  if (
    typeof response.url !== "string" || typeof response.hostname !== "string" ||
    typeof response.pageKey !== "string" || typeof response.siteEnabled !== "boolean" ||
    !isRuleMode(response.pageMode) || !isRuleMode(response.siteMode) ||
    !isDisposition(response.effectiveMode) || !isRuleSource(response.effectiveSource)
  ) throw new Error("后台返回了不完整的页面状态。");

  return {
    url: response.url,
    hostname: response.hostname,
    pageKey: response.pageKey,
    siteEnabled: response.siteEnabled,
    pageMode: response.pageMode,
    siteMode: response.siteMode,
    globalCategoryRules: isRecord(response.globalCategoryRules) ? response.globalCategoryRules as PopupContext["globalCategoryRules"] : createDefaultGlobalCategoryRules(),
    siteCategoryRules: isRecord(response.siteCategoryRules) ? response.siteCategoryRules as PopupContext["siteCategoryRules"] : {},
    personalRules: Array.isArray(response.personalRules) ? response.personalRules as PopupContext["personalRules"] : [],
    effectiveMode: response.effectiveMode,
    effectiveSource: response.effectiveSource,
    supported: typeof response.supported === "boolean" ? response.supported : true,
    siteAuthorizationRecorded: typeof response.siteAuthorizationRecorded === "boolean" ? response.siteAuthorizationRecorded : false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function isDisposition(value: unknown): value is NavigationDisposition { return value === "same-tab" || value === "new-tab" || value === "preserve-native"; }
function isRuleMode(value: unknown): value is RuleMode { return value === "inherit" || isDisposition(value); }
function isRuleSource(value: unknown): value is RuleSource { return value === "category" || value === "site" || value === "page" || value === "disabled"; }
