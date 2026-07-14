import test from "node:test";
import assert from "node:assert/strict";

import {
  isAnchorNavigationAlreadyHandled,
  isAnchorNavigationAlreadyObserved,
  markAnchorNavigationObserved,
  shouldSkipAnchorNavigationEvent,
  shouldInterceptNavigation,
  shouldTakeOverAnchorNavigation,
  takeOverAnchorNavigation,
} from "./anchor-events";
import { applyNavigationExecutionOutcome } from "../lib/navigation";

test("接管锚点点击时会阻止默认行为、阻止传播并标记事件已处理", () => {
  const { event, counters } = createMouseEvent();

  takeOverAnchorNavigation(event);

  assert.equal(counters.preventDefault, 1);
  assert.equal(counters.stopPropagation, 1);
  assert.equal(counters.stopImmediatePropagation, 1);
  assert.equal(event.defaultPrevented, true);
  assert.equal(isAnchorNavigationAlreadyHandled(event), true);
});

test("same-tab 和 new-tab 都会进入扩展接管分支", () => {
  const sameTabEvent = createMouseEvent().event;
  const newTabEvent = createMouseEvent().event;

  assert.equal(shouldTakeOverAnchorNavigation(sameTabEvent, "same-tab"), true);
  assert.equal(shouldTakeOverAnchorNavigation(newTabEvent, "new-tab"), true);
});

test("preserve-native 不会进入扩展接管分支", () => {
  const { event } = createMouseEvent();

  assert.equal(shouldTakeOverAnchorNavigation(event, "preserve-native"), false);
  assert.equal(isAnchorNavigationAlreadyHandled(event), false);
});

test("期望跳转方式与浏览器原生行为一致时无需接管", () => {
  assert.equal(shouldInterceptNavigation("same-tab", "same-tab"), false);
  assert.equal(shouldInterceptNavigation("new-tab", "new-tab"), false);
  assert.equal(shouldInterceptNavigation("preserve-native", "same-tab"), false);
  assert.equal(shouldInterceptNavigation("preserve-native", "new-tab"), false);
  assert.equal(shouldInterceptNavigation("new-tab", "same-tab"), true);
  assert.equal(shouldInterceptNavigation("same-tab", "new-tab"), true);
});

test("capture 阶段观察过 preserve-native 后，bubble 阶段不会重复记录", () => {
  const { event } = createMouseEvent();

  assert.equal(isAnchorNavigationAlreadyObserved(event), false);

  markAnchorNavigationObserved(event);

  assert.equal(isAnchorNavigationAlreadyObserved(event), true);
  assert.equal(shouldSkipAnchorNavigationEvent(event, true), true);
  assert.equal(isAnchorNavigationAlreadyHandled(event), false);
});

test("事件一旦被扩展接管，后续阶段会直接跳过，避免重复处理", () => {
  const { event } = createMouseEvent();

  takeOverAnchorNavigation(event);

  assert.equal(shouldTakeOverAnchorNavigation(event, "new-tab"), false);
  assert.equal(shouldSkipAnchorNavigationEvent(event, true), true);
});

test("已经被页面 preventDefault 的事件继续尊重页面原始处理结果", () => {
  const { event } = createMouseEvent({ defaultPrevented: true });

  assert.equal(shouldSkipAnchorNavigationEvent(event, true), true);
  assert.equal(isAnchorNavigationAlreadyHandled(event), false);
});

test("不可取消的事件不会再被扩展接管", () => {
  const { event } = createMouseEvent({ cancelable: false });

  assert.equal(shouldSkipAnchorNavigationEvent(event, true), true);
});

test("脚本生成的不可信点击不会被扩展权限升级为标签页操作", () => {
  const { event } = createMouseEvent({ isTrusted: false });

  assert.equal(shouldSkipAnchorNavigationEvent(event, true), true);
});

test("新标签执行失败并退回当前页时不会虚报 requested action 已应用", () => {
  const decision = {
    category: "link-same-origin" as const,
    requestedDisposition: "new-tab" as const,
    nativeDisposition: "same-tab" as const,
    disposition: "new-tab" as const,
    applied: true,
    reason: "global-category:link-same-origin",
    resolvedBy: "global-category" as const,
  };

  assert.deepEqual(
    applyNavigationExecutionOutcome(decision, {
      applied: false,
      disposition: "same-tab",
      bypassReason: "new-tab-fallback-current-tab",
    }),
    {
      ...decision,
      applied: false,
      disposition: "same-tab",
      bypassReason: "new-tab-fallback-current-tab",
    },
  );
});

function createMouseEvent(
  overrides: Partial<MouseEvent> = {},
): {
  event: MouseEvent;
  counters: Record<"preventDefault" | "stopPropagation" | "stopImmediatePropagation", number>;
} {
  const counters = {
    preventDefault: 0,
    stopPropagation: 0,
    stopImmediatePropagation: 0,
  };

  const event = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    cancelable: true,
    preventDefault() {
      counters.preventDefault += 1;
      (this as unknown as { defaultPrevented: boolean }).defaultPrevented = true;
    },
    stopPropagation() {
      counters.stopPropagation += 1;
    },
    stopImmediatePropagation() {
      counters.stopImmediatePropagation += 1;
    },
    ...overrides,
  } as MouseEvent;

  return { event, counters };
}
