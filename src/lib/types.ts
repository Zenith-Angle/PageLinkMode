export type NavigationMode = "same-tab" | "new-tab";
export type NavigationDisposition = NavigationMode | "preserve-native";
export type RuleMode = "inherit" | NavigationMode;
export type RuleSource = "global" | "site" | "page";

export interface ExtensionState {
  globalMode: NavigationMode;
  siteRules: Record<string, NavigationMode>;
  pageRules: Record<string, NavigationMode>;
}

export interface ResolvedContext {
  url: string;
  hostname: string;
  pageKey: string;
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
