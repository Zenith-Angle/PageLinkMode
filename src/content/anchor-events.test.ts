import test from "node:test";
import assert from "node:assert/strict";

import {
  isAnchorNavigationAlreadyHandled,
  shouldSkipAnchorNavigationEvent,
  shouldTakeOverAnchorNavigation,
  takeOverAnchorNavigation,
} from "./anchor-events";

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
