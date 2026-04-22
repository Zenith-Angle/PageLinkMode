import type {
  ExtensionState,
  NavigationCategory,
  NavigationDebugRecord,
  NavigationDebugRecordInput,
  NavigationDisposition,
  NavigationMode,
  PopupContext,
  ResolvedContext,
  RuleMode,
  SetBadgePayload,
  SiteCategoryRule,
} from "./types";

export type RuntimeRequest =
  | { type: "plm:get-context"; url: string }
  | { type: "plm:get-popup-context"; url: string }
  | { type: "plm:ping-content" }
  | { type: "plm:mark-site-authorized"; hostname: string }
  | { type: "plm:get-state" }
  | { type: "plm:get-debug-records" }
  | { type: "plm:clear-debug-records" }
  | { type: "plm:append-debug-record"; record: NavigationDebugRecordInput }
  | { type: "plm:replace-state"; state: ExtensionState }
  | { type: "plm:open-url"; url: string; mode: NavigationMode }
  | { type: "plm:set-global-mode"; mode: NavigationMode }
  | {
      type: "plm:set-global-category-rule";
      category: NavigationCategory;
      disposition: NavigationDisposition;
    }
  | { type: "plm:set-site-enabled"; hostname: string; enabled: boolean }
  | { type: "plm:set-site-rule"; hostname: string; mode: RuleMode }
  | { type: "plm:set-page-rule"; url: string; mode: RuleMode }
  | {
      type: "plm:set-site-category-rule";
      hostname: string;
      category: NavigationCategory;
      rule: SiteCategoryRule;
    }
  | { type: "plm:remove-site-rule"; hostname: string }
  | { type: "plm:remove-page-rule"; url: string }
  | { type: "plm:set-badge"; payload: SetBadgePayload };

export type RuntimeResponse =
  | ExtensionState
  | PopupContext
  | ResolvedContext
  | NavigationDebugRecord[]
  | { ok: true }
  | { ok: false; error: string };
