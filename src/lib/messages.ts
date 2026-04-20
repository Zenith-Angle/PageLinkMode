import type {
  ExtensionState,
  NavigationMode,
  PopupContext,
  ResolvedContext,
  RuleMode,
  SetBadgePayload,
} from "./types";

export type RuntimeRequest =
  | { type: "plm:get-context"; url: string }
  | { type: "plm:get-popup-context"; url: string }
  | { type: "plm:ping-content" }
  | { type: "plm:mark-site-authorized"; hostname: string }
  | { type: "plm:get-state" }
  | { type: "plm:replace-state"; state: ExtensionState }
  | { type: "plm:open-url"; url: string; mode: NavigationMode }
  | { type: "plm:set-global-mode"; mode: NavigationMode }
  | { type: "plm:set-site-rule"; hostname: string; mode: RuleMode }
  | { type: "plm:set-page-rule"; url: string; mode: RuleMode }
  | { type: "plm:remove-site-rule"; hostname: string }
  | { type: "plm:remove-page-rule"; url: string }
  | { type: "plm:set-badge"; payload: SetBadgePayload };

export type RuntimeResponse =
  | ExtensionState
  | PopupContext
  | ResolvedContext
  | { ok: true }
  | { ok: false; error: string };
