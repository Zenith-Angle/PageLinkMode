import test from "node:test";
import assert from "node:assert/strict";

import {
  scheduleTakeoverScopeRangeRecovery,
  syncTakeoverScopeRange,
} from "./scope-control";

test("初始化会覆盖浏览器恢复的旧 range 状态，并同步数值与进度", () => {
  const range = createRangeFixture("4", "100%");

  // 模拟存储仍为“最广”，但 Chrome 在 Popup 重开时只把原生控件值恢复到中间档。
  range.value = "2";
  syncTakeoverScopeRange(range, 4);

  assert.equal(range.value, "4");
  assert.equal(range.defaultValue, "4");
  assert.equal(range.attributes.value, "4");
  assert.equal(range.properties["--scope-progress"], "100%");
  assert.equal(range.parentProperties["--scope-progress"], "100%");
});

test("中间档会同时把 range 和轨道进度同步到 50%", () => {
  const range = createRangeFixture("4", "100%");

  syncTakeoverScopeRange(range, 2);

  assert.equal(range.value, "2");
  assert.equal(range.defaultValue, "2");
  assert.equal(range.attributes.value, "2");
  assert.equal(range.properties["--scope-progress"], "50%");
  assert.equal(range.parentProperties["--scope-progress"], "50%");
});

test("延迟恢复会覆盖 Chrome 在初始化后写回的旧表单状态", () => {
  const range = createRangeFixture("4", "100%");
  const scheduler = createSchedulerFixture();

  scheduleTakeoverScopeRangeRecovery(range, 4, scheduler);
  range.value = "2";
  range.properties["--scope-progress"] = "";
  scheduler.runAll();

  assert.equal(range.value, "4");
  assert.equal(range.defaultValue, "4");
  assert.equal(range.attributes.value, "4");
  assert.equal(range.properties["--scope-progress"], "100%");
  assert.equal(range.parentProperties["--scope-progress"], "100%");
  assert.deepEqual(scheduler.delays, [0, 50, 250, 1000]);
});

test("用户开始操作后会取消延迟恢复，不覆盖新的档位", () => {
  const range = createRangeFixture("4", "100%");
  const scheduler = createSchedulerFixture();

  const cancelRecovery = scheduleTakeoverScopeRangeRecovery(range, 4, scheduler);
  cancelRecovery();
  syncTakeoverScopeRange(range, 2);
  scheduler.runAll();

  assert.equal(range.value, "2");
  assert.equal(range.properties["--scope-progress"], "50%");
});

function createRangeFixture(initialValue: string, initialProgress: string) {
  const attributes: Record<string, string> = { value: initialValue };
  const properties: Record<string, string> = {
    "--scope-progress": initialProgress,
  };
  const parentProperties: Record<string, string> = {
    "--scope-progress": initialProgress,
  };

  return {
    value: initialValue,
    defaultValue: initialValue,
    attributes,
    properties,
    parentProperties,
    parentElement: {
      style: {
        setProperty(name: string, value: string) {
          parentProperties[name] = value;
        },
      },
    },
    setAttribute(name: string, value: string) {
      attributes[name] = value;
    },
    style: {
      setProperty(name: string, value: string) {
        properties[name] = value;
      },
    },
  };
}

function createSchedulerFixture() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];

  return {
    delays,
    requestAnimationFrame(callback: () => void) {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle: number) {
      callbacks.delete(handle);
    },
    setTimeout(callback: () => void, delay: number) {
      const handle = nextHandle++;
      delays.push(delay);
      callbacks.set(handle, callback);
      return handle;
    },
    clearTimeout(handle: number) {
      callbacks.delete(handle);
    },
    runAll() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
  };
}
