import type { RuleSource, SetBadgePayload } from "../lib/types";

const SOURCE_COLORS: Record<RuleSource, string> = {
  global: "#64748b",
  site: "#0f766e",
  page: "#ea580c",
  disabled: "#475569",
};

export async function updateBadge(payload: SetBadgePayload): Promise<void> {
  if (!payload.tabId) {
    return;
  }

  await chrome.action.setBadgeText({
    tabId: payload.tabId,
    text: payload.source === "disabled" ? "关" : payload.mode === "same-tab" ? "同" : "新",
  });

  await chrome.action.setBadgeBackgroundColor({
    tabId: payload.tabId,
    color: SOURCE_COLORS[payload.source],
  });
}
