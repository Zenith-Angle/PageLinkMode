import type {
  CategoryRuleMap,
  NavigationCategory,
  NavigationDisposition,
} from "./types";

export interface NavigationCategoryDefinition {
  id: NavigationCategory;
  label: string;
  description: string;
  triggerLabel: string;
}

export const NAVIGATION_CATEGORY_DEFINITIONS: NavigationCategoryDefinition[] = [
  {
    id: "same-origin-content-link",
    label: "同站内容链接",
    description: "当前站点内的普通正文、卡片、列表内容链接。",
    triggerLabel: "链接",
  },
  {
    id: "cross-origin-content-link",
    label: "跨站内容链接",
    description: "从当前页面跳到其他域名的普通内容链接。",
    triggerLabel: "链接",
  },
  {
    id: "site-shell-navigation",
    label: "站点壳层/首页导航",
    description: "头部导航、首页入口、站点壳层切换等基础导航。",
    triggerLabel: "链接",
  },
  {
    id: "pagination-navigation",
    label: "传统分页",
    description: "页码、上一页、下一页、首尾页等集合浏览控制。",
    triggerLabel: "链接",
  },
  {
    id: "image-viewer-link",
    label: "图片预览/原图查看",
    description: "Lightbox、原图、图片查看器、相册预览等入口。",
    triggerLabel: "链接",
  },
  {
    id: "auth-link",
    label: "认证相关链接",
    description: "登录、登出、认证回调、会话校验等同站认证入口。",
    triggerLabel: "链接",
  },
  {
    id: "get-form-submit",
    label: "GET 表单提交",
    description: "搜索、筛选等使用 GET 方法的表单提交。",
    triggerLabel: "表单",
  },
  {
    id: "non-get-form-submit",
    label: "非 GET 表单提交",
    description: "POST/PUT 等会提交数据的表单请求。",
    triggerLabel: "表单",
  },
  {
    id: "window-open",
    label: "普通 window.open",
    description: "页面脚本主动打开普通内容页面的窗口或标签。",
    triggerLabel: "window.open",
  },
  {
    id: "auth-window-open",
    label: "认证相关 window.open",
    description: "脚本打开登录、认证、回调等相关窗口。",
    triggerLabel: "window.open",
  },
  {
    id: "image-window-open",
    label: "图片相关 window.open",
    description: "脚本打开原图、图片预览、查看器等窗口。",
    triggerLabel: "window.open",
  },
  {
    id: "named-or-popup-window-open",
    label: "命名窗口/弹窗式 window.open",
    description: "带命名 target 或 popup features 的窗口打开行为。",
    triggerLabel: "window.open",
  },
];

export const NAVIGATION_CATEGORY_ORDER = NAVIGATION_CATEGORY_DEFINITIONS.map(
  (definition) => definition.id,
);

export const DEFAULT_GLOBAL_CATEGORY_RULES: CategoryRuleMap = {
  "same-origin-content-link": "new-tab",
  "cross-origin-content-link": "new-tab",
  "site-shell-navigation": "same-tab",
  "pagination-navigation": "preserve-native",
  "image-viewer-link": "preserve-native",
  "auth-link": "same-tab",
  "get-form-submit": "preserve-native",
  "non-get-form-submit": "same-tab",
  "window-open": "new-tab",
  "auth-window-open": "preserve-native",
  "image-window-open": "preserve-native",
  "named-or-popup-window-open": "preserve-native",
};

export function createDefaultGlobalCategoryRules(): CategoryRuleMap {
  return { ...DEFAULT_GLOBAL_CATEGORY_RULES };
}

export function createEmptySiteCategoryRules() {
  return {} as Record<string, Partial<Record<NavigationCategory, NavigationDisposition>>>;
}

export function getCategoryDefinition(category: NavigationCategory): NavigationCategoryDefinition {
  return (
    NAVIGATION_CATEGORY_DEFINITIONS.find((definition) => definition.id === category) ??
    NAVIGATION_CATEGORY_DEFINITIONS[0]
  );
}
