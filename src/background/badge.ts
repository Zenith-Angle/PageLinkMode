import type { SetBadgePayload } from "../lib/types";

const STATUS_ICON_PATHS = {
  managed: {
    16: "icons/icon16-managed.png",
    32: "icons/icon32-managed.png",
  },
  unmanaged: {
    16: "icons/icon16-unmanaged.png",
    32: "icons/icon32-unmanaged.png",
  },
} as const;

export async function updateBadge(payload: SetBadgePayload): Promise<void> {
  if (payload.tabId === undefined) {
    return;
  }

  const presentation = getBadgePresentation(payload);

  try {
    await chrome.action.setBadgeText({
      tabId: payload.tabId,
      text: presentation.text,
    });

    await chrome.action.setIcon({
      tabId: payload.tabId,
      path: presentation.path,
    });
  } catch {
    // 图标只是状态提示；构建发布或扩展重载的瞬间不可用时不能影响导航主链路。
  }
}

export function getBadgePresentation(payload: SetBadgePayload): {
  text: string;
  path: { readonly 16: string; readonly 32: string };
} {
  // 原生 badge 有不可控的最小底板；状态点直接合成到图标，才能保持小而圆。
  return {
    text: "",
    path: payload.managed ? STATUS_ICON_PATHS.managed : STATUS_ICON_PATHS.unmanaged,
  };
}
