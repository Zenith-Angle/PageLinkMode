import { getCategoryDefinition, NAVIGATION_CATEGORY_ORDER } from "./navigation-categories";
import type { NavigationCategory, TakeoverScopeLevel } from "./types";

export interface TakeoverScopeDefinition {
  level: TakeoverScopeLevel;
  label: string;
  shortDescription: string;
}

export const DEFAULT_TAKEOVER_SCOPE_LEVEL: TakeoverScopeLevel = 4;
export const TAKEOVER_SCOPE_LEVELS: TakeoverScopeDefinition[] = [
  { level: 0, label: "精准", shortDescription: "仅普通同源内容" },
  { level: 1, label: "内容", shortDescription: "加入同站、跨站和内容导航" },
  { level: 2, label: "广泛", shortDescription: "加入常见页面语义" },
  { level: 3, label: "深入", shortDescription: "加入标准表单" },
  { level: 4, label: "最广", shortDescription: "加入脚本打开" },
];

export function isTakeoverScopeLevel(value: unknown): value is TakeoverScopeLevel {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

export function getTakeoverScopeDefinition(level: TakeoverScopeLevel): TakeoverScopeDefinition {
  return TAKEOVER_SCOPE_LEVELS[level];
}

export function getMinimumTakeoverScopeLevel(category: NavigationCategory): TakeoverScopeLevel {
  if (category === "link-same-origin") return 0;
  if (category === "link-same-site" || category === "link-cross-site" || category === "link-site-root" || category === "link-primary-navigation" || category === "link-list-detail" || category === "link-document" || category === "link-media") return 1;
  if (category.startsWith("link-")) return 2;
  if (category.startsWith("form-")) return 3;
  return 4;
}

export function isCategoryWithinTakeoverScope(category: NavigationCategory, level: TakeoverScopeLevel): boolean {
  return level >= getMinimumTakeoverScopeLevel(category);
}

export function isSafetyProtectedCategory(category: NavigationCategory): boolean {
  return getCategoryDefinition(category).protection !== "normal";
}

export function shouldHandleAnchorInCapturePhase(_level?: TakeoverScopeLevel): boolean {
  return true;
}

export function countCategoriesWithinTakeoverScope(level: TakeoverScopeLevel): number {
  return NAVIGATION_CATEGORY_ORDER.filter((category) => level >= getMinimumTakeoverScopeLevel(category)).length;
}
