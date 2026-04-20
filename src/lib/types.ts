export type NavigationMode = "same-tab" | "new-tab";
export type NavigationDisposition = NavigationMode | "preserve-native";
export type RuleMode = "inherit" | NavigationMode;
export type RuleSource = "global" | "site" | "page" | "disabled";

export interface ExtensionState {
  globalMode: NavigationMode;
  siteRules: Record<string, NavigationMode>;
  pageRules: Record<string, NavigationMode>;
  disabledSites: string[];
}

export interface ResolvedContext {
  url: string;
  hostname: string;
  pageKey: string;
  siteEnabled: boolean;
  globalMode: NavigationMode;
  siteMode: RuleMode;
  pageMode: RuleMode;
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
}

export interface SetBadgePayload {
  tabId?: number;
  mode: NavigationMode;
  source: RuleSource;
}
