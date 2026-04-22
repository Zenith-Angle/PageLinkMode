export type NavigationMode = "same-tab" | "new-tab";
export type NavigationDisposition = NavigationMode | "preserve-native";
export type RuleMode = "inherit" | NavigationMode;
export type SiteCategoryRule = "inherit" | NavigationDisposition;
export type RuleSource = "global" | "site" | "page" | "disabled";
export type NavigationDecisionSource =
  | "page"
  | "site"
  | "site-category"
  | "global-category"
  | "disabled";
export type NavigationTrigger = "anchor" | "form" | "window.open";
export type NavigationCategory =
  | "same-origin-content-link"
  | "cross-origin-content-link"
  | "site-shell-navigation"
  | "pagination-navigation"
  | "image-viewer-link"
  | "auth-link"
  | "get-form-submit"
  | "non-get-form-submit"
  | "window-open"
  | "auth-window-open"
  | "image-window-open"
  | "named-or-popup-window-open";

export type CategoryRuleMap = Record<NavigationCategory, NavigationDisposition>;
export type SiteCategoryRuleMap = Partial<Record<NavigationCategory, SiteCategoryRule>>;

export interface ExtensionState {
  schemaVersion: 2;
  globalMode: NavigationMode;
  globalCategoryRules: CategoryRuleMap;
  siteCategoryRules: Record<string, SiteCategoryRuleMap>;
  siteRules: Record<string, NavigationMode>;
  pageRules: Record<string, NavigationMode>;
  disabledSites: string[];
}

export interface NavigationResolutionContext {
  siteEnabled: boolean;
  pageMode: RuleMode;
  siteMode: RuleMode;
  globalCategoryRules: CategoryRuleMap;
  siteCategoryRules: SiteCategoryRuleMap;
}

export interface ResolvedContext extends NavigationResolutionContext {
  url: string;
  hostname: string;
  pageKey: string;
  globalMode: NavigationMode;
  effectiveMode: NavigationMode;
  effectiveSource: RuleSource;
}

export interface PopupContext extends ResolvedContext {
  supported: boolean;
  siteAuthorizationRecorded: boolean;
}

export interface BridgeWindowOpenMessage {
  source: "pagelinkmode-bridge";
  type: "window-open";
  url: string;
  category: NavigationCategory;
  disposition: NavigationDisposition;
  reason: string;
  resolvedBy: NavigationDecisionSource;
}

export interface PageBridgeConfig extends NavigationResolutionContext {}

export interface NavigationDecision {
  category: NavigationCategory;
  disposition: NavigationDisposition;
  reason: string;
  resolvedBy: NavigationDecisionSource;
}

export interface NavigationDebugRecord {
  id: string;
  timestamp: number;
  hostname: string;
  pageUrl: string;
  targetUrl: string;
  trigger: NavigationTrigger;
  category: NavigationCategory;
  disposition: NavigationDisposition;
  resolvedBy: NavigationDecisionSource;
  reason: string;
}

export interface NavigationDebugRecordInput {
  pageUrl: string;
  targetUrl: string;
  trigger: NavigationTrigger;
  category: NavigationCategory;
  disposition: NavigationDisposition;
  resolvedBy: NavigationDecisionSource;
  reason: string;
}

export interface SetBadgePayload {
  tabId?: number;
  mode: NavigationMode;
  source: RuleSource;
}
