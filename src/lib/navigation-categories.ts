import type {
  BasicPresetId,
  CategoryRuleMap,
  NavigationCategory,
  NavigationDisposition,
} from "./types";

export type NavigationCategoryGroup = "link-relation" | "link-purpose" | "form" | "window-open";

export interface NavigationCategoryDefinition {
  id: NavigationCategory;
  group: NavigationCategoryGroup;
  label: string;
  description: string;
  triggerLabel: string;
  protection: "normal" | "sensitive" | "hard-native";
}

const define = (
  id: NavigationCategory,
  group: NavigationCategoryGroup,
  label: string,
  description: string,
  triggerLabel: string,
  protection: NavigationCategoryDefinition["protection"] = "normal",
): NavigationCategoryDefinition => ({ id, group, label, description, triggerLabel, protection });

export const NAVIGATION_CATEGORY_DEFINITIONS: NavigationCategoryDefinition[] = [
  define("link-same-origin", "link-relation", "同源普通链接", "协议、主机和端口均与当前页面相同的普通内容链接。", "链接"),
  define("link-same-site", "link-relation", "同站跨子域链接", "注册域相同，但子域、协议或端口不同的普通内容链接。", "链接"),
  define("link-cross-site", "link-relation", "跨站普通链接", "目标属于其他注册域的普通内容链接。", "链接"),
  define("link-site-root", "link-purpose", "首页与站点 Logo", "首页入口、站点 Logo 和返回主站的链接。", "链接"),
  define("link-primary-navigation", "link-purpose", "主导航与菜单", "页头、侧栏和主要导航区域中的站点导航。", "链接"),
  define("link-breadcrumb-tab", "link-purpose", "面包屑与页面 Tab", "面包屑、页面内视图 Tab 和局部导航。", "链接"),
  define("link-list-detail", "link-purpose", "列表与卡片详情", "从列表、信息流或卡片进入内容详情。", "链接"),
  define("link-pagination", "link-purpose", "集合分页", "页码、上一页、下一页和首尾页。", "链接"),
  define("link-content-sequence", "link-purpose", "上一篇与下一篇", "文章、章节或媒体内容之间的顺序导航。", "链接"),
  define("link-search-filter", "link-purpose", "搜索筛选与排序", "通过链接改变搜索条件、筛选条件或排序方式。", "链接"),
  define("link-image-gallery", "link-purpose", "图片与相册", "原图、图片预览、Lightbox 和相册入口。", "链接"),
  define("link-document", "link-purpose", "PDF 与文档", "PDF、办公文档和可在线阅读的文档资源。", "链接"),
  define("link-media", "link-purpose", "音视频媒体", "音频、视频和媒体播放页面。", "链接"),
  define("link-spa-route", "link-purpose", "SPA 与 Hash 路由", "不对应文档锚点的站内软路由。", "链接"),
  define("link-auth-account", "link-purpose", "登录与账户", "登录、注册、认证回调和账户安全流程。", "链接", "sensitive"),
  define("link-payment-checkout", "link-purpose", "支付与结算", "付款、订单确认、结算和购买流程。", "链接", "sensitive"),
  define("form-search-get", "form", "搜索/筛选 GET 表单", "不会写入数据的搜索和筛选提交。", "表单"),
  define("form-general-get", "form", "普通 GET 表单", "其他使用 GET 方法的标准表单提交。", "表单"),
  define("form-non-get", "form", "非 GET 表单", "POST 等可能写入数据的提交。", "表单", "sensitive"),
  define("form-auth-payment", "form", "认证/支付表单", "登录、认证、支付和结算相关表单。", "表单", "sensitive"),
  define("open-same-origin", "window-open", "同源脚本打开", "页面脚本打开同源普通内容。", "window.open"),
  define("open-same-site", "window-open", "同站脚本打开", "页面脚本打开同站不同子域内容。", "window.open"),
  define("open-cross-site", "window-open", "跨站脚本打开", "页面脚本打开其他站点内容。", "window.open"),
  define("open-image-gallery", "window-open", "图片脚本打开", "脚本打开图片、相册或预览页面。", "window.open"),
  define("open-document-media", "window-open", "文档/媒体脚本打开", "脚本打开 PDF、文档、音频或视频。", "window.open"),
  define("open-auth-payment", "window-open", "认证/支付脚本打开", "脚本打开登录、认证、支付或结算流程。", "window.open", "sensitive"),
  define("open-popup-named", "window-open", "命名窗口与弹窗", "依赖窗口名称、尺寸或 WindowProxy 的弹窗。", "window.open", "hard-native"),
];

export const NAVIGATION_CATEGORY_ORDER = NAVIGATION_CATEGORY_DEFINITIONS.map((item) => item.id);

const nativeRules = (): CategoryRuleMap =>
  Object.fromEntries(NAVIGATION_CATEGORY_ORDER.map((id) => [id, "preserve-native"])) as CategoryRuleMap;

function withActions(
  base: CategoryRuleMap,
  entries: Partial<Record<NavigationCategory, NavigationDisposition | "inherit">>,
): CategoryRuleMap {
  return { ...base, ...entries };
}

export function createPresetCategoryRules(preset: Exclude<BasicPresetId, "custom">): CategoryRuleMap {
  const precise = withActions(nativeRules(), {
    "link-same-origin": "new-tab",
  });
  if (preset === "precise") {
    return precise;
  }

  const content = withActions(precise, {
    "link-same-site": "new-tab",
    "link-cross-site": "new-tab",
    "link-site-root": "same-tab",
    "link-primary-navigation": "same-tab",
    "link-breadcrumb-tab": "same-tab",
    "link-list-detail": "new-tab",
    "link-document": "new-tab",
    "link-media": "new-tab",
  });
  if (preset === "content") {
    return content;
  }

  const broad = withActions(content, {
    "link-pagination": "same-tab",
    "link-content-sequence": "same-tab",
    "link-search-filter": "same-tab",
  });
  if (preset === "broad") {
    return broad;
  }

  const deep = withActions(broad, {
    "form-search-get": "same-tab",
    "form-general-get": "same-tab",
  });
  if (preset === "deep") {
    return deep;
  }

  return withActions(deep, {
    "open-same-origin": "new-tab",
    "open-same-site": "new-tab",
    "open-cross-site": "new-tab",
    "open-document-media": "new-tab",
  });
}

export const DEFAULT_PRESET_ID: BasicPresetId = "content";
export const DEFAULT_GLOBAL_CATEGORY_RULES = createPresetCategoryRules("content");

export function createDefaultGlobalCategoryRules(): CategoryRuleMap {
  return { ...DEFAULT_GLOBAL_CATEGORY_RULES };
}

export function getCategoryDefinition(category: NavigationCategory): NavigationCategoryDefinition {
  return NAVIGATION_CATEGORY_DEFINITIONS.find((item) => item.id === category) ?? NAVIGATION_CATEGORY_DEFINITIONS[0];
}

export function isSensitiveCategory(category: NavigationCategory): boolean {
  return getCategoryDefinition(category).protection === "sensitive";
}

export function isHardNativeCategory(category: NavigationCategory): boolean {
  return getCategoryDefinition(category).protection === "hard-native";
}
