import type { TakeoverScopeLevel } from "./types";

export interface ScopeRangeControl {
  value: string;
  defaultValue: string;
  parentElement?: {
    style: {
      setProperty(name: string, value: string): void;
    };
  } | null;
  setAttribute(name: string, value: string): void;
  style: {
    setProperty(name: string, value: string): void;
  };
}

export interface ScopeRangeSyncScheduler {
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}

const RANGE_RECOVERY_DELAYS = [0, 50, 250, 1000] as const;

export function syncTakeoverScopeRange(
  range: ScopeRangeControl,
  level: TakeoverScopeLevel,
): void {
  const value = String(level);
  const progress = `${(level / 4) * 100}%`;

  // Chrome 可能在扩展 Popup 重开时恢复 range 的旧表单状态，因此同时覆盖属性和属性值。
  range.value = value;
  range.defaultValue = value;
  range.setAttribute("value", value);
  range.style.setProperty("--scope-progress", progress);
  range.parentElement?.style.setProperty("--scope-progress", progress);
}

export function scheduleTakeoverScopeRangeRecovery(
  range: ScopeRangeControl,
  level: TakeoverScopeLevel,
  scheduler: ScopeRangeSyncScheduler,
): () => void {
  let isActive = true;
  const recover = () => {
    if (isActive) {
      syncTakeoverScopeRange(range, level);
    }
  };

  // Chrome 会在扩展页面首次绘制后再次恢复原生表单值，跨多个绘制阶段短时校正。
  recover();
  const animationHandle = scheduler.requestAnimationFrame(recover);
  const timeoutHandles = RANGE_RECOVERY_DELAYS.map((delay) => scheduler.setTimeout(recover, delay));

  return () => {
    if (!isActive) {
      return;
    }
    isActive = false;
    scheduler.cancelAnimationFrame(animationHandle);
    timeoutHandles.forEach((handle) => scheduler.clearTimeout(handle));
  };
}
