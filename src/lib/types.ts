export type NavigationMode = "same-tab" | "new-tab";
export type NavigationDisposition = NavigationMode | "preserve-native";
/** 仅供 0.5.1 配置迁移与旧测试夹具使用；v4 运行时不再使用硬范围门禁。 */
export type TakeoverScopeLevel = 0 | 1 | 2 | 3 | 4;
export type RuleMode = "inherit" | NavigationDisposition;
export type SiteCategoryRule = "inherit" | NavigationDisposition;
export type BasicPresetId = "precise" | "content" | "broad" | "deep" | "widest" | "custom";

export type RuleSource = "site" | "page" | "category" | "disabled";
export type NavigationDecisionSource =
  | "personal-page"
  | "page"
  | "personal-site"
  | "site"
  | "site-category"
  | "global-category"
  | "capability"
  | "risk"
  | "disabled"
  | "native-fallback";

export type NavigationTrigger = "anchor" | "form" | "window.open";
export type NavigableLinkElement = HTMLAnchorElement | HTMLAreaElement | SVGAElement;

export type NavigationCategory =
  | "link-same-origin"
  | "link-same-site"
  | "link-cross-site"
  | "link-site-root"
  | "link-primary-navigation"
  | "link-breadcrumb-tab"
  | "link-list-detail"
  | "link-pagination"
  | "link-content-sequence"
  | "link-search-filter"
  | "link-image-gallery"
  | "link-document"
  | "link-media"
  | "link-spa-route"
  | "link-auth-account"
  | "link-payment-checkout"
  | "form-search-get"
  | "form-general-get"
  | "form-non-get"
  | "form-auth-payment"
  | "open-same-origin"
  | "open-same-site"
  | "open-cross-site"
  | "open-image-gallery"
  | "open-document-media"
  | "open-auth-payment"
  | "open-popup-named";

export type NavigationRelation = "same-document" | "same-origin" | "same-site" | "cross-site";
export type NavigationSemantic =
  | "content"
  | "site-root"
  | "primary-navigation"
  | "breadcrumb-tab"
  | "list-detail"
  | "pagination"
  | "content-sequence"
  | "search-filter"
  | "image-gallery"
  | "document"
  | "media"
  | "spa-route"
  | "auth-account"
  | "payment-checkout"
  | "popup"
  | "unknown";
export type NativeTargetKind = "self" | "blank" | "named" | "parent" | "top" | "unfenced-top";
export type NavigationFrameContext = "top" | "same-origin-frame" | "cross-origin-frame";
export type NavigationUserIntent = "plain" | "modified" | "middle" | "script-active" | "script-passive";

export interface NavigationCapability {
  canRewrite: boolean;
  risk: "normal" | "sensitive" | "hard-blocked";
  blockers: string[];
}

export interface NavigationFacts {
  trigger: NavigationTrigger;
  sourceUrl: string;
  targetUrl: string;
  relation: NavigationRelation;
  protocol: string;
  semantics: NavigationSemantic[];
  nativeTarget: NativeTargetKind;
  nativeDisposition: NavigationDisposition;
  frameContext: NavigationFrameContext;
  userIntent: NavigationUserIntent;
  formMethod?: string;
  elementTag?: string;
  elementAttributes?: Record<string, string>;
  evidence: string[];
  capability: NavigationCapability;
}

export type BasicCategoryRule = RuleMode;
export type CategoryRuleMap = Record<NavigationCategory, BasicCategoryRule>;
export type SiteCategoryRuleMap = Partial<Record<NavigationCategory, SiteCategoryRule>>;

export type UrlMatcherKind = "exact" | "prefix" | "glob" | "regex";
export interface UrlMatcher {
  kind: UrlMatcherKind;
  value: string;
}

export interface PersonalRuleMatch {
  sourceUrl?: UrlMatcher;
  targetUrl?: UrlMatcher;
  relations?: NavigationRelation[];
  triggers?: NavigationTrigger[];
  semantics?: NavigationSemantic[];
  nativeTargets?: NativeTargetKind[];
  frameContexts?: NavigationFrameContext[];
  formMethods?: string[];
  element?: {
    selector?: string;
    tag?: string;
    attributes?: Record<string, string>;
  };
}

export interface PersonalRule {
  id: string;
  name: string;
  enabled: boolean;
  scope: { type: "site"; hostname: string } | { type: "page"; pageKey: string; hostname: string };
  order: number;
  action: NavigationDisposition;
  match: PersonalRuleMatch;
  sensitiveEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RiskGrant {
  hostname: string;
  grantedAt: number;
  confirmationVersion: 1;
}

export interface ExtensionState {
  schemaVersion: 4;
  presetId: BasicPresetId;
  globalCategoryRules: CategoryRuleMap;
  siteCategoryRules: Record<string, SiteCategoryRuleMap>;
  siteRules: Record<string, NavigationDisposition>;
  pageRules: Record<string, NavigationDisposition>;
  personalRules: PersonalRule[];
  disabledSites: string[];
}

export interface NavigationResolutionContext {
  siteEnabled: boolean;
  pageMode: RuleMode;
  siteMode: RuleMode;
  globalCategoryRules: CategoryRuleMap;
  siteCategoryRules: SiteCategoryRuleMap;
  personalRules: PersonalRule[];
  riskGrant?: RiskGrant;
}

export interface ResolvedContext extends NavigationResolutionContext {
  url: string;
  hostname: string;
  pageKey: string;
  effectiveMode: NavigationDisposition;
  effectiveSource: RuleSource;
}

export interface PopupContext extends ResolvedContext {
  supported: boolean;
  siteAuthorizationRecorded: boolean;
}

export interface BridgeWindowOpenMessage {
  source: "pagelinkmode-bridge";
  type: "window-open";
  bridgeToken: string;
  facts: NavigationFacts;
  decision: NavigationDecision;
}

export interface PageBridgeConfig extends NavigationResolutionContext {
  bridgeToken: string;
  pageUrl: string;
}

export interface NavigationClassification {
  category: NavigationCategory;
  reason: string;
  semantics: NavigationSemantic[];
  evidence: string[];
}

export interface NavigationDecision {
  category: NavigationCategory;
  requestedDisposition: NavigationDisposition;
  nativeDisposition: NavigationDisposition;
  disposition: NavigationDisposition;
  applied: boolean;
  bypassReason?: string;
  reason: string;
  resolvedBy: NavigationDecisionSource;
  winningRuleId?: string;
}

export interface NavigationExecutionOutcome {
  disposition: NavigationDisposition;
  applied: boolean;
  bypassReason?: string;
}

export interface NavigationDebugRecord {
  id: string;
  timestamp: number;
  hostname: string;
  pageUrl: string;
  targetUrl: string;
  trigger: NavigationTrigger;
  category: NavigationCategory;
  requestedDisposition: NavigationDisposition;
  nativeDisposition: NavigationDisposition;
  disposition: NavigationDisposition;
  applied: boolean;
  bypassReason?: string;
  resolvedBy: NavigationDecisionSource;
  winningRuleId?: string;
  evidence: string[];
  reason: string;
}

export type NavigationDebugRecordInput = Omit<NavigationDebugRecord, "id" | "timestamp" | "hostname">;

export interface ConfigurationBackup {
  formatVersion: 1;
  extensionVersion: string;
  exportedAt: string;
  state: ExtensionState;
}

export interface SetBadgePayload {
  tabId?: number;
  managed: boolean;
}
