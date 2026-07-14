import type {
  BasicPresetId,
  ConfigurationBackup,
  ExtensionState,
  NavigationCategory,
  NavigationDebugRecord,
  NavigationDebugRecordInput,
  NavigationDecision,
  NavigationDisposition,
  NavigationFacts,
  NavigationMode,
  PersonalRule,
  PopupContext,
  ResolvedContext,
  RiskGrant,
  RuleMode,
  SetBadgePayload,
  SiteCategoryRule,
} from "./types";

export type RuntimeRequest =
  | { type: "plm:get-context"; url: string }
  | { type: "plm:get-popup-context"; url: string }
  | { type: "plm:ping-content" }
  | { type: "plm:update-context"; context: ResolvedContext }
  | { type: "plm:refresh-context" }
  | { type: "plm:mark-site-authorized"; hostname: string }
  | { type: "plm:get-state" }
  | { type: "plm:replace-state"; state: unknown }
  | { type: "plm:export-backup" }
  | { type: "plm:import-backup"; backup: unknown }
  | { type: "plm:apply-preset"; presetId: Exclude<BasicPresetId, "custom"> }
  | { type: "plm:set-global-category-rule"; category: NavigationCategory; rule: RuleMode }
  | { type: "plm:set-site-category-rule"; hostname: string; category: NavigationCategory; rule: SiteCategoryRule }
  | { type: "plm:set-site-enabled"; hostname: string; enabled: boolean }
  | { type: "plm:set-site-rule"; hostname: string; mode: RuleMode }
  | { type: "plm:set-page-rule"; url: string; mode: RuleMode }
  | { type: "plm:remove-site-rule"; hostname: string }
  | { type: "plm:remove-page-rule"; url: string }
  | { type: "plm:upsert-personal-rule"; rule: PersonalRule }
  | { type: "plm:remove-personal-rule"; id: string }
  | { type: "plm:reorder-personal-rules"; firstId: string; secondId: string }
  | { type: "plm:get-risk-grants" }
  | { type: "plm:get-risk-grant"; hostname: string }
  | { type: "plm:grant-risk"; hostname: string }
  | { type: "plm:revoke-risk"; hostname: string }
  | { type: "plm:simulate-navigation"; facts: NavigationFacts }
  | { type: "plm:get-debug-records" }
  | { type: "plm:clear-debug-records" }
  | { type: "plm:append-debug-record"; record: NavigationDebugRecordInput }
  | { type: "plm:open-url"; url: string; mode: NavigationMode }
  | { type: "plm:set-badge"; payload: SetBadgePayload };

export type RuntimeResponse =
  | ExtensionState
  | PopupContext
  | ResolvedContext
  | NavigationDebugRecord[]
  | RiskGrant[]
  | RiskGrant
  | null
  | ConfigurationBackup
  | NavigationDecision
  | { ok: true }
  | { ok: false; error: string };
