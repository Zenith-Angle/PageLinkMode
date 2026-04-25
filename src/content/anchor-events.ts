import type { NavigationDisposition } from "../lib/types";
import { hasPointerModifier, isPageHandledNavigationEvent } from "./dom";

type AnchorHandledMouseEvent = MouseEvent & {
  __PAGELINKMODE_ANCHOR_NAVIGATION_HANDLED__?: true;
};

const ANCHOR_NAVIGATION_HANDLED_FLAG = "__PAGELINKMODE_ANCHOR_NAVIGATION_HANDLED__";

export function shouldSkipAnchorNavigationEvent(
  event: MouseEvent,
  hasActiveContext: boolean,
): boolean {
  return (
    !hasActiveContext ||
    hasPointerModifier(event) ||
    isPageHandledNavigationEvent(event) ||
    isAnchorNavigationAlreadyHandled(event)
  );
}

export function shouldTakeOverAnchorNavigation(
  event: MouseEvent,
  disposition: NavigationDisposition,
): boolean {
  return disposition !== "preserve-native" && !isAnchorNavigationAlreadyHandled(event);
}

export function takeOverAnchorNavigation(event: MouseEvent): void {
  const mutableEvent = event as AnchorHandledMouseEvent;

  // 先标记“这个点击已经被扩展接管”，再终止默认行为和后续传播。
  // 这样即使同一个事件对象因为浏览器实现差异再次被后续逻辑看见，
  // 也能明确识别为“已处理”，避免重复发消息或重复记调试日志。
  mutableEvent[ANCHOR_NAVIGATION_HANDLED_FLAG] = true;

  // 这里不仅要阻止浏览器默认跳转，还要阻止页面后续 click 监听里的脚本导航，
  // 否则会出现扩展已经开了新标签，但当前页仍被站点脚本带走的“双跳转”问题。
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

export function isAnchorNavigationAlreadyHandled(event: MouseEvent): boolean {
  const mutableEvent = event as AnchorHandledMouseEvent;
  return mutableEvent[ANCHOR_NAVIGATION_HANDLED_FLAG] === true;
}
