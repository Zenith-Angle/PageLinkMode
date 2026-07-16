import "./styles/base.css";
import "./styles/options.css";

import {
  createPresetCategoryRules,
  getCategoryDefinition,
  NAVIGATION_CATEGORY_DEFINITIONS,
  type NavigationCategoryGroup,
} from "./lib/navigation-categories";
import type { RuntimeRequest, RuntimeResponse } from "./lib/messages";
import type {
  BasicPresetId,
  ConfigurationBackup,
  ExtensionState,
  NavigationCategory,
  NavigationDecision,
  NavigationDebugRecord,
  NavigationDisposition,
  NavigationFacts,
  NavigationFrameContext,
  NavigationRelation,
  NavigationSemantic,
  NavigationTrigger,
  NavigationUserIntent,
  NativeTargetKind,
  PersonalRule,
  RiskGrant,
  RuleMode,
  SiteCategoryRule,
  TakeoverScopeLevel,
  UrlMatcherKind,
} from "./lib/types";
import {
  scheduleTakeoverScopeRangeRecovery,
  syncTakeoverScopeRange,
} from "./lib/scope-control";
import { getHostname, isSupportedPageUrl, normalizePageUrl } from "./lib/url";

type WorkspaceView = "basic" | "sites" | "personal" | "debug" | "pages" | "backup";

const PRESETS: Array<{ id: Exclude<BasicPresetId, "custom">; label: string; description: string }> = [
  { id: "precise", label: "精准", description: "仅普通同源内容" },
  { id: "content", label: "内容", description: "加入常用内容入口" },
  { id: "broad", label: "适中", description: "覆盖多数日常浏览（推荐）" },
  { id: "deep", label: "深入", description: "加入筛选、相册和 GET 表单" },
  { id: "widest", label: "最广", description: "加入翻页和脚本打开" },
];

const GROUPS: Array<{ id: NavigationCategoryGroup; label: string }> = [
  { id: "link-relation", label: "普通链接" },
  { id: "link-purpose", label: "页面语义" },
  { id: "form", label: "表单提交" },
  { id: "window-open", label: "脚本打开" },
];

const SEMANTICS: NavigationSemantic[] = [
  "content", "site-root", "primary-navigation", "breadcrumb-tab", "list-detail",
  "pagination", "content-sequence", "search-filter", "image-gallery", "document",
  "media", "spa-route", "auth-account", "payment-checkout", "popup", "unknown",
];

const SEMANTIC_LABELS: Record<NavigationSemantic, string> = {
  content: "普通内容", "site-root": "首页/Logo", "primary-navigation": "主导航",
  "breadcrumb-tab": "面包屑/Tab", "list-detail": "列表详情", pagination: "分页",
  "content-sequence": "上一篇/下一篇", "search-filter": "搜索筛选", "image-gallery": "图片相册",
  document: "文档", media: "媒体", "spa-route": "SPA 路由", "auth-account": "认证账户",
  "payment-checkout": "支付结算", popup: "弹窗", unknown: "未知",
};

const RELATION_OPTIONS: Array<[NavigationRelation, string]> = [
  ["same-document", "同文档"], ["same-origin", "同源"], ["same-site", "同站"], ["cross-site", "跨站"],
];
const TRIGGER_OPTIONS: Array<[NavigationTrigger, string]> = [
  ["anchor", "链接"], ["form", "表单"], ["window.open", "window.open"],
];
const NATIVE_TARGET_OPTIONS: Array<[NativeTargetKind, string]> = [
  ["self", "self"], ["blank", "blank"], ["named", "命名窗口"], ["parent", "parent"],
  ["top", "top"], ["unfenced-top", "unfencedTop"],
];
const FRAME_CONTEXT_OPTIONS: Array<[NavigationFrameContext, string]> = [
  ["top", "顶层页面"], ["same-origin-frame", "同源 frame"], ["cross-origin-frame", "跨源 frame"],
];
const FORM_METHOD_OPTIONS: Array<[string, string]> = [
  ["GET", "GET"], ["POST", "POST"], ["PUT", "PUT"], ["PATCH", "PATCH"], ["DELETE", "DELETE"],
];

const DECISION_CHAIN: Array<{ source: NavigationDecision["resolvedBy"]; label: string }> = [
  { source: "capability", label: "技术硬限制" },
  { source: "disabled", label: "站点停用" },
  { source: "risk", label: "风险授权" },
  { source: "personal-page", label: "页面个性化规则" },
  { source: "page", label: "页面整体规则" },
  { source: "personal-site", label: "站点个性化规则" },
  { source: "site", label: "站点整体规则" },
  { source: "site-category", label: "站点分类" },
  { source: "global-category", label: "全局分类" },
  { source: "native-fallback", label: "原生兜底" },
];

const PRESET_LABELS: Record<BasicPresetId, string> = {
  precise: "精准", content: "内容", broad: "适中", deep: "深入", widest: "最广", custom: "自定义",
};

const PRESET_BY_LEVEL: Array<Exclude<BasicPresetId, "custom">> = [
  "precise", "content", "broad", "deep", "widest",
];

let currentState: ExtensionState | null = null;
let currentDebugRecords: NavigationDebugRecord[] = [];
let currentRiskGrants: RiskGrant[] = [];
let pendingPreset: Exclude<BasicPresetId, "custom"> | null = null;
let selectedPreset: Exclude<BasicPresetId, "custom"> | null = null;
let cancelPresetRangeRecovery: (() => void) | null = null;
let requestedPreset: Exclude<BasicPresetId, "custom"> | null = null;
let requestedPersonalScope: { type: "site" | "page"; hostname: string; pageKey?: string } | null = null;
let selectedRiskHostname: string | null = null;
let editingPageRuleUrl: string | null = null;
const manuallyAddedSites = new Set<string>();

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少界面元素 #${id}`);
  return element as T;
};

document.addEventListener("DOMContentLoaded", () => {
  bindWorkspace();
  populateChoiceGroups();
  bindStaticActions();
  resetSimulator();
  void loadDashboard();
});

window.addEventListener("pageshow", () => {
  if (selectedPreset) beginPresetRangeRecovery(selectedPreset);
});

function bindWorkspace(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-workspace-tab]").forEach((button) => {
    button.addEventListener("click", () => selectWorkspace(button.dataset.workspaceTab as WorkspaceView, true));
  });
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get("view") as WorkspaceView | null;
  selectWorkspace(requestedView && isWorkspaceView(requestedView) ? requestedView : "basic", false);
  const hostname = params.get("hostname");
  const pageKey = params.get("page");
  const preset = params.get("preset");
  const scope = params.get("scope");
  if (isSelectablePreset(preset)) requestedPreset = preset;
  if (hostname && (scope === "site" || (scope === "page" && pageKey))) {
    requestedPersonalScope = { type: scope, hostname, ...(pageKey ? { pageKey } : {}) };
  }
}

function bindStaticActions(): void {
  const presetRange = byId<HTMLInputElement>("basic-preset-range");
  presetRange.addEventListener("pointerdown", stopPresetRangeRecovery);
  presetRange.addEventListener("keydown", stopPresetRangeRecovery);
  presetRange.addEventListener("input", () => {
    stopPresetRangeRecovery();
    const preset = readPresetRangeValue(presetRange);
    if (preset) {
      selectedPreset = preset;
      renderPresetControl(preset);
    }
  });
  presetRange.addEventListener("change", () => {
    const preset = readPresetRangeValue(presetRange);
    if (preset) openPresetDialog(preset);
  });
  byId<HTMLButtonElement>("preview-preset").addEventListener("click", () => {
    if (selectedPreset) openPresetDialog(selectedPreset);
  });
  byId<HTMLFormElement>("add-site-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = byId<HTMLInputElement>("add-site-hostname");
    const hostname = normalizeHostname(input.value);
    if (!hostname) return setStatus("请输入有效的 hostname。", "error");
    manuallyAddedSites.add(hostname);
    input.value = "";
    if (currentState) renderSites(currentState);
  });
  byId<HTMLButtonElement>("new-personal-rule").addEventListener("click", () => openPersonalEditor());
  byId<HTMLButtonElement>("close-personal-editor").addEventListener("click", closePersonalEditor);
  byId<HTMLSelectElement>("personal-scope-type").addEventListener("change", syncPersonalScopeFields);
  byId<HTMLFormElement>("personal-rule-editor").addEventListener("submit", (event) => void savePersonalRule(event));
  byId<HTMLButtonElement>("delete-personal-rule").addEventListener("click", () => void deletePersonalRule());
  byId<HTMLButtonElement>("add-personal-attribute").addEventListener("click", () => addAttributeRow());
  byId<HTMLButtonElement>("unlock-risk").addEventListener("click", openRiskDialog);
  byId<HTMLButtonElement>("revoke-risk").addEventListener("click", () => void revokeRiskGrant());
  byId<HTMLInputElement>("risk-acknowledge").addEventListener("change", syncRiskConfirmation);
  byId<HTMLInputElement>("risk-confirm-hostname").addEventListener("input", syncRiskConfirmation);
  byId<HTMLFormElement>("risk-confirm-form").addEventListener("submit", (event) => void confirmRiskGrant(event));
  byId<HTMLButtonElement>("clear-debug-records").addEventListener("click", () => void clearDebugRecords());
  byId<HTMLSelectElement>("debug-filter").addEventListener("change", renderDebugRecords);
  byId<HTMLFormElement>("simulator-form").addEventListener("submit", (event) => void runNavigationSimulation(event));
  byId<HTMLButtonElement>("reset-simulator").addEventListener("click", resetSimulator);
  byId<HTMLButtonElement>("export-config").addEventListener("click", () => void exportConfiguration());
  byId<HTMLButtonElement>("import-config").addEventListener("click", () => byId<HTMLInputElement>("import-config-input").click());
  byId<HTMLInputElement>("import-config-input").addEventListener("change", () => void importConfiguration());
  byId<HTMLFormElement>("page-rule-form").addEventListener("submit", (event) => void savePageRule(event));
  byId<HTMLButtonElement>("confirm-preset").addEventListener("click", () => void applyPendingPreset());
  byId("personal-action").replaceWith(createActionGroup(
    "personal-action",
    [["same-tab", "同标签"], ["new-tab", "新标签"], ["preserve-native", "保持原生"]],
    "preserve-native",
    () => undefined,
  ));
}

async function loadDashboard(): Promise<void> {
  try {
    const [state, records, grants] = await Promise.all([
      send<ExtensionState>({ type: "plm:get-state" }),
      send<NavigationDebugRecord[]>({ type: "plm:get-debug-records" }),
      send<RiskGrant[]>({ type: "plm:get-risk-grants" }),
    ]);
    currentState = state;
    currentDebugRecords = records;
    currentRiskGrants = grants;
    renderAll();
    consumeRequestedActions();
  } catch (error) {
    setStatus(`加载失败：${getErrorMessage(error)}`, "error");
  }
}

function renderAll(): void {
  if (!currentState) return;
  byId("category-count").textContent = String(NAVIGATION_CATEGORY_DEFINITIONS.length);
  byId("site-count").textContent = String(collectSiteKeys(currentState).length);
  byId("personal-count").textContent = String(currentState.personalRules.length);
  byId("active-preset").textContent = `当前：${PRESET_LABELS[currentState.presetId]}`;
  if (!selectedPreset) {
    selectedPreset = currentState.presetId === "custom" ? "broad" : currentState.presetId;
  }
  renderPresetControl(selectedPreset);
  renderPresets();
  renderGlobalCategories(currentState);
  renderSites(currentState);
  renderPersonalRules(currentState.personalRules);
  renderDebugFilter();
  renderDebugRecords();
  renderPageRules(currentState);
  renderRiskState();
}

function renderPresets(): void {
  const container = byId("preset-list");
  container.replaceChildren();
}

function renderPresetControl(preset: Exclude<BasicPresetId, "custom">): void {
  const definition = PRESETS.find((candidate) => candidate.id === preset)!;
  const level = PRESET_BY_LEVEL.indexOf(preset) as TakeoverScopeLevel;
  const range = byId<HTMLInputElement>("basic-preset-range");
  syncTakeoverScopeRange(range, level);
  range.setAttribute("aria-valuetext", `${definition.label}：${definition.description}，待确认应用`);
  byId("preset-selection-label").textContent = `待选：${definition.label}`;

  if (currentState) {
    const next = createPresetCategoryRules(preset);
    const changed = NAVIGATION_CATEGORY_DEFINITIONS.filter(
      (category) => currentState!.globalCategoryRules[category.id] !== next[category.id],
    ).length;
    byId("preset-impact").textContent = `将修改 ${changed} 个基础分类；拖动不会直接保存。`;
  }
}

function beginPresetRangeRecovery(preset: Exclude<BasicPresetId, "custom">): void {
  stopPresetRangeRecovery();
  const range = byId<HTMLInputElement>("basic-preset-range");
  cancelPresetRangeRecovery = scheduleTakeoverScopeRangeRecovery(
    range,
    PRESET_BY_LEVEL.indexOf(preset) as TakeoverScopeLevel,
    window,
  );
}

function stopPresetRangeRecovery(): void {
  cancelPresetRangeRecovery?.();
  cancelPresetRangeRecovery = null;
}

function readPresetRangeValue(range: HTMLInputElement): Exclude<BasicPresetId, "custom"> | null {
  const level = Number(range.value);
  return Number.isInteger(level) ? PRESET_BY_LEVEL[level] ?? null : null;
}

function renderGlobalCategories(state: ExtensionState): void {
  const container = byId("global-category-rules");
  container.replaceChildren(...GROUPS.map((group, index) => {
    const details = document.createElement("details");
    details.className = "category-group";
    details.open = index < 2;
    const definitions = NAVIGATION_CATEGORY_DEFINITIONS.filter((item) => item.group === group.id);
    const summary = document.createElement("summary");
    const name = document.createElement("span");
    name.textContent = group.label;
    const count = document.createElement("span");
    count.className = "category-group-count";
    count.textContent = `${definitions.length} 类`;
    summary.append(name, count);
    details.append(summary, ...definitions.map((definition) => createCategoryRow(
      definition.id,
      state.globalCategoryRules[definition.id],
      "global",
    )));
    return details;
  }));
}

function createCategoryRow(
  category: NavigationCategory,
  selected: RuleMode,
  scope: "global" | "site",
  hostname?: string,
): HTMLElement {
  const definition = getCategoryDefinition(category);
  const row = document.createElement("article");
  row.className = "category-row";
  row.dataset.protection = definition.protection;
  const copy = document.createElement("div");
  copy.className = "category-copy";
  const title = document.createElement("strong");
  title.textContent = definition.label;
  const description = document.createElement("p");
  description.textContent = definition.description;
  copy.append(title, description);

  const locked = definition.protection !== "normal";
  const supportsInheritance = scope === "site" || definition.group === "link-purpose" ||
    category === "open-image-gallery" || category === "open-document-media";
  const options: Array<[RuleMode, string]> = supportsInheritance ? [["inherit", "继承"]] : [];
  options.push(["same-tab", "同标签"], ["new-tab", "新标签"], ["preserve-native", "保持原生"]);
  const group = createActionGroup(undefined, options, locked ? "preserve-native" : selected, (value) => {
    if (scope === "global") void updateGlobalCategory(category, value);
    else if (hostname) void updateSiteCategory(hostname, category, value);
  }, locked);
  row.append(copy, group);
  return row;
}

function renderSites(state: ExtensionState): void {
  const container = byId("site-rule-cards");
  const keys = collectSiteKeys(state);
  if (keys.length === 0) {
    container.replaceChildren(createEmpty("暂无站点覆写。"));
    return;
  }
  container.replaceChildren(...keys.map((hostname) => {
    const details = document.createElement("details");
    details.className = "site-card";
    const summary = document.createElement("summary");
    const title = document.createElement("strong");
    title.textContent = hostname;
    const badge = document.createElement("span");
    badge.className = "status-badge";
    const enabled = !state.disabledSites.includes(hostname);
    badge.dataset.tone = enabled ? "success" : "warning";
    badge.textContent = enabled ? "已启用" : "已停用";
    summary.append(title, badge);
    const body = document.createElement("div");
    body.className = "site-card-body";
    const bar = document.createElement("div");
    bar.className = "site-control-bar";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "secondary-button";
    toggle.textContent = enabled ? "停用站点" : "启用站点";
    toggle.addEventListener("click", () => void toggleSite(hostname, !enabled));
    const overall = createActionGroup(undefined, [
      ["inherit", "继承分类"], ["same-tab", "同标签"], ["new-tab", "新标签"], ["preserve-native", "保持原生"],
    ], state.siteRules[hostname] ?? "inherit", (value) => void updateSiteOverall(hostname, value));
    bar.append(toggle, overall);
    const matrix = document.createElement("div");
    matrix.className = "site-matrix";
    matrix.append(...NAVIGATION_CATEGORY_DEFINITIONS.map((definition) => createCategoryRow(
      definition.id,
      state.siteCategoryRules[hostname]?.[definition.id] ?? "inherit",
      "site",
      hostname,
    )));
    body.append(bar, matrix);
    details.append(summary, body);
    return details;
  }));
}

function renderPersonalRules(rules: PersonalRule[]): void {
  const container = byId("personal-rule-list");
  const ordered = [...rules].sort(comparePersonalRules);
  if (ordered.length === 0) {
    container.replaceChildren(createEmpty("暂无个性化规则。"));
    return;
  }
  container.replaceChildren(...ordered.map((rule, index) => {
    const item = document.createElement("article");
    item.className = "personal-rule-item";
    item.tabIndex = 0;
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = rule.name;
    const description = document.createElement("p");
    description.textContent = `${rule.scope.type === "page" ? "页面" : "站点"} · ${rule.scope.hostname} · ${renderDisposition(rule.action)}`;
    copy.append(name, description);
    const actions = document.createElement("div");
    actions.className = "toolbar-actions";
    const toggle = iconButton(rule.enabled ? "暂停" : "启用", rule.enabled ? "Ⅱ" : "▶", () => void togglePersonalRule(rule));
    const up = iconButton("上移", "↑", () => void movePersonalRule(rule, -1));
    const down = iconButton("下移", "↓", () => void movePersonalRule(rule, 1));
    up.disabled = index === 0 || !hasSamePersonalScope(ordered[index - 1], rule);
    down.disabled = index === ordered.length - 1 || !hasSamePersonalScope(ordered[index + 1], rule);
    actions.append(toggle, up, down);
    item.append(copy, actions);
    item.addEventListener("click", (event) => { if (!(event.target instanceof HTMLButtonElement)) openPersonalEditor(rule); });
    item.addEventListener("keydown", (event) => { if (event.key === "Enter") openPersonalEditor(rule); });
    return item;
  }));
}

function openPersonalEditor(rule?: PersonalRule): void {
  const form = byId<HTMLFormElement>("personal-rule-editor");
  setPersonalEditorOpen(true);
  form.reset();
  if (rule) selectRiskContext(rule.scope.hostname);
  byId("personal-editor-title").textContent = rule ? "编辑规则" : "新建规则";
  byId<HTMLInputElement>("personal-rule-id").value = rule?.id ?? "";
  byId<HTMLInputElement>("personal-name").value = rule?.name ?? "";
  byId<HTMLSelectElement>("personal-scope-type").value = rule?.scope.type ?? "site";
  byId<HTMLInputElement>("personal-hostname").value = rule?.scope.hostname ?? "";
  byId<HTMLInputElement>("personal-page-key").value = rule?.scope.type === "page" ? rule.scope.pageKey : "";
  setMatcherFields("source", rule?.match.sourceUrl);
  setMatcherFields("target", rule?.match.targetUrl);
  setChoiceValues("personal-relations", rule?.match.relations ?? []);
  setChoiceValues("personal-triggers", rule?.match.triggers ?? []);
  setChoiceValues("personal-semantics", rule?.match.semantics ?? []);
  setChoiceValues("personal-native-targets", rule?.match.nativeTargets ?? []);
  setChoiceValues("personal-frame-contexts", rule?.match.frameContexts ?? []);
  const formMethods = rule?.match.formMethods?.map((method) => method.toUpperCase()) ?? [];
  const standardMethods = new Set(FORM_METHOD_OPTIONS.map(([value]) => value));
  setChoiceValues("personal-form-methods", formMethods.filter((method) => standardMethods.has(method)));
  byId<HTMLInputElement>("personal-custom-form-methods").value = formMethods.filter((method) => !standardMethods.has(method)).join(", ");
  byId<HTMLInputElement>("personal-element-tag").value = rule?.match.element?.tag ?? "";
  byId<HTMLInputElement>("personal-selector").value = rule?.match.element?.selector ?? "";
  renderAttributeRows(rule?.match.element?.attributes);
  byId<HTMLInputElement>("personal-sensitive").checked = rule?.sensitiveEnabled ?? false;
  syncActionSelection(byId("personal-action"), rule?.action ?? "preserve-native");
  byId<HTMLButtonElement>("delete-personal-rule").hidden = !rule;
  syncPersonalScopeFields();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closePersonalEditor(): void { setPersonalEditorOpen(false); }

function setPersonalEditorOpen(open: boolean): void {
  byId<HTMLFormElement>("personal-rule-editor").hidden = !open;
  const workspace = byId("personal-rule-editor").closest<HTMLElement>(".split-workspace");
  if (workspace) workspace.dataset.editorOpen = String(open);
}

async function savePersonalRule(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!currentState) return;
  const id = byId<HTMLInputElement>("personal-rule-id").value;
  const existing = currentState.personalRules.find((rule) => rule.id === id);
  const hostname = normalizeHostname(byId<HTMLInputElement>("personal-hostname").value);
  if (!hostname) return setStatus("个性化规则必须绑定有效站点。", "error");
  const scopeType = byId<HTMLSelectElement>("personal-scope-type").value as "site" | "page";
  const rawPageKey = byId<HTMLInputElement>("personal-page-key").value.trim();
  const normalizedPage = scopeType === "page" ? normalizeHttpPage(rawPageKey) : null;
  if (scopeType === "page" && !normalizedPage) {
    return setStatus("页面规则必须填写有效的 http/https 页面 URL。", "error");
  }
  if (normalizedPage && normalizedPage.hostname !== hostname) {
    return setStatus("页面 URL 的 hostname 必须与规则绑定站点一致。", "error");
  }
  const sensitiveEnabled = byId<HTMLInputElement>("personal-sensitive").checked;
  if (sensitiveEnabled && !hasRiskGrant(hostname)) {
    if (selectedRiskHostname !== hostname) {
      return setStatus("高风险规则需要明确站点上下文。请从当前站点、页面或已有规则进入后解锁。", "error");
    }
    return setStatus(`请先在下方风险区解锁 ${hostname}，再逐条启用高风险规则。`, "error");
  }
  const now = Date.now();
  const scope: PersonalRule["scope"] = scopeType === "page"
    ? { type: "page", pageKey: normalizedPage!.url, hostname }
    : { type: "site", hostname };
  const rule: PersonalRule = {
    id: existing?.id ?? crypto.randomUUID(),
    name: byId<HTMLInputElement>("personal-name").value.trim(),
    enabled: existing?.enabled ?? true,
    scope,
    order: existing?.order ?? nextRuleOrder(scope),
    action: getActionSelection(byId("personal-action")),
    match: buildPersonalMatch(),
    sensitiveEnabled,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  try {
    currentState = await send<ExtensionState>({ type: "plm:upsert-personal-rule", rule });
    renderAll();
    closePersonalEditor();
    setStatus("个性化规则已保存。", "success");
  } catch (error) { setStatus(`保存失败：${getErrorMessage(error)}`, "error"); }
}

async function deletePersonalRule(): Promise<void> {
  const id = byId<HTMLInputElement>("personal-rule-id").value;
  if (!id || !currentState) return;
  try {
    currentState = await send<ExtensionState>({ type: "plm:remove-personal-rule", id });
    renderAll();
    closePersonalEditor();
    clearRiskContext();
    setStatus("规则已删除。", "success");
  } catch (error) {
    setStatus(`删除失败：${getErrorMessage(error)}。规则内容已保留，可重试。`, "error");
  }
}

async function togglePersonalRule(rule: PersonalRule): Promise<void> {
  try {
    currentState = await send<ExtensionState>({ type: "plm:upsert-personal-rule", rule: { ...rule, enabled: !rule.enabled, updatedAt: Date.now() } });
    renderAll();
    setStatus(rule.enabled ? "规则已暂停。" : "规则已启用。", "success");
  } catch (error) {
    renderAll();
    setStatus(`更新失败：${getErrorMessage(error)}。请重试。`, "error");
  }
}

async function movePersonalRule(rule: PersonalRule, offset: number): Promise<void> {
  if (!currentState) return;
  const group = currentState.personalRules.filter((candidate) => hasSamePersonalScope(candidate, rule)).sort((a, b) => a.order - b.order);
  const index = group.findIndex((candidate) => candidate.id === rule.id);
  const swap = group[index + offset];
  if (!swap) return;
  try {
    currentState = await send<ExtensionState>({ type: "plm:reorder-personal-rules", firstId: rule.id, secondId: swap.id });
    renderAll();
    setStatus("规则顺序已保存。", "success");
  } catch (error) {
    renderAll();
    setStatus(`排序失败：${getErrorMessage(error)}。原顺序未改变。`, "error");
  }
}

function openPresetDialog(preset: Exclude<BasicPresetId, "custom">): void {
  if (!currentState) return;
  selectedPreset = preset;
  renderPresetControl(preset);
  pendingPreset = preset;
  const next = createPresetCategoryRules(preset);
  const changes = NAVIGATION_CATEGORY_DEFINITIONS.filter((definition) => currentState!.globalCategoryRules[definition.id] !== next[definition.id]);
  byId("preset-dialog-summary").textContent = `“${PRESET_LABELS[preset]}”将修改 ${changes.length} 个全局分类。站点覆写不会改变。`;
  byId("preset-diff").replaceChildren(...changes.map((definition) => {
    const row = document.createElement("div");
    row.className = "preset-diff-row";
    const label = document.createElement("span"); label.textContent = definition.label;
    const value = document.createElement("strong"); value.textContent = renderRuleMode(next[definition.id]);
    row.append(label, value); return row;
  }));
  const dialog = byId<HTMLDialogElement>("preset-dialog");
  if (!dialog.open) dialog.showModal();
}

async function applyPendingPreset(): Promise<void> {
  if (!pendingPreset) return;
  try {
    currentState = await send<ExtensionState>({ type: "plm:apply-preset", presetId: pendingPreset });
    selectedPreset = pendingPreset;
    pendingPreset = null;
    renderAll();
    setStatus("基础预设已应用。", "success");
  } catch (error) {
    setStatus(`预设应用失败：${getErrorMessage(error)}。当前配置未改变，可重试。`, "error");
  }
}

function consumeRequestedActions(): void {
  if (requestedPersonalScope) {
    const request = requestedPersonalScope;
    requestedPersonalScope = null;
    selectWorkspace("personal", false);
    openPersonalEditor();
    const hostname = normalizeHostname(request.hostname);
    byId<HTMLSelectElement>("personal-scope-type").value = request.type;
    byId<HTMLInputElement>("personal-hostname").value = hostname;
    byId<HTMLInputElement>("personal-page-key").value = request.pageKey ?? "";
    const page = request.type === "page" ? normalizeHttpPage(request.pageKey ?? "") : null;
    if (hostname && (request.type === "site" || page?.hostname === hostname)) {
      selectRiskContext(hostname);
    } else {
      setStatus("深链中的页面与站点不一致，未绑定高风险授权上下文。", "error");
    }
    syncPersonalScopeFields();
  }

  if (requestedPreset) {
    const preset = requestedPreset;
    requestedPreset = null;
    selectedPreset = preset;
    selectWorkspace("basic", false);
    openPresetDialog(preset);
  }

  if (selectedPreset) beginPresetRangeRecovery(selectedPreset);
}

function isSelectablePreset(value: string | null): value is Exclude<BasicPresetId, "custom"> {
  return value !== null && PRESET_BY_LEVEL.includes(value as Exclude<BasicPresetId, "custom">);
}

async function updateGlobalCategory(category: NavigationCategory, rule: RuleMode): Promise<void> {
  try {
    currentState = await send<ExtensionState>({ type: "plm:set-global-category-rule", category, rule });
    renderAll();
    setStatus("全局分类已保存。", "success");
  } catch (error) {
    renderAll();
    setStatus(`全局分类保存失败：${getErrorMessage(error)}。请重试。`, "error");
  }
}

async function updateSiteCategory(hostname: string, category: NavigationCategory, rule: SiteCategoryRule): Promise<void> {
  try {
    currentState = await send<ExtensionState>({ type: "plm:set-site-category-rule", hostname, category, rule });
    renderAll();
    setStatus("站点分类已保存。", "success");
  } catch (error) {
    renderAll();
    setStatus(`站点分类保存失败：${getErrorMessage(error)}。请重试。`, "error");
  }
}

async function updateSiteOverall(hostname: string, mode: RuleMode): Promise<void> {
  try {
    currentState = await send<ExtensionState>({ type: "plm:set-site-rule", hostname, mode });
    renderAll();
    setStatus("站点整体规则已保存。", "success");
  } catch (error) {
    renderAll();
    setStatus(`站点整体规则保存失败：${getErrorMessage(error)}。请重试。`, "error");
  }
}

async function toggleSite(hostname: string, enabled: boolean): Promise<void> {
  try {
    currentState = await send<ExtensionState>({ type: "plm:set-site-enabled", hostname, enabled });
    renderAll();
    setStatus(enabled ? "站点已启用。" : "站点已停用。", "success");
  } catch (error) {
    renderAll();
    setStatus(`站点状态更新失败：${getErrorMessage(error)}。请重试。`, "error");
  }
}

function openRiskDialog(): void {
  const hostname = selectedRiskHostname;
  if (!hostname) return setStatus("请先从当前站点、页面、调试记录或已有规则进入，再解锁高风险规则。", "error");
  byId<HTMLInputElement>("risk-confirm-hostname").value = "";
  byId<HTMLInputElement>("risk-acknowledge").checked = false;
  syncRiskConfirmation();
  byId<HTMLDialogElement>("risk-dialog").showModal();
}

function syncRiskConfirmation(): void {
  const expected = selectedRiskHostname;
  const actual = normalizeHostname(byId<HTMLInputElement>("risk-confirm-hostname").value);
  byId<HTMLButtonElement>("confirm-risk").disabled = !byId<HTMLInputElement>("risk-acknowledge").checked || !expected || actual !== expected;
}

async function confirmRiskGrant(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const hostname = selectedRiskHostname;
  if (!hostname) return setStatus("风险站点上下文已失效，请重新从站点或页面入口进入。", "error");
  try {
    currentRiskGrants = await send<RiskGrant[]>({ type: "plm:grant-risk", hostname });
    byId<HTMLDialogElement>("risk-dialog").close();
    renderRiskState();
    setStatus(`已解锁 ${hostname} 的高风险规则。`, "success");
  } catch (error) {
    setStatus(`高风险授权失败：${getErrorMessage(error)}。确认内容已保留，可重试。`, "error");
  }
}

async function revokeRiskGrant(): Promise<void> {
  const hostname = selectedRiskHostname;
  if (!hostname) return;
  try {
    currentRiskGrants = await send<RiskGrant[]>({ type: "plm:revoke-risk", hostname });
    renderRiskState();
    setStatus(`已撤销 ${hostname} 的高风险授权。`, "success");
  } catch (error) {
    setStatus(`撤销失败：${getErrorMessage(error)}。授权状态未改变，可重试。`, "error");
  }
}

function renderRiskState(): void {
  const hostname = selectedRiskHostname;
  byId<HTMLInputElement>("risk-hostname").value = hostname ?? "";
  const granted = hostname ? hasRiskGrant(hostname) : false;
  byId("risk-state").textContent = !hostname ? "未选择站点" : granted ? "本机已解锁" : "默认关闭";
  byId<HTMLButtonElement>("revoke-risk").disabled = !granted;
  byId<HTMLButtonElement>("unlock-risk").disabled = !hostname || granted;
}

function renderDebugFilter(): void {
  const select = byId<HTMLSelectElement>("debug-filter");
  const value = select.value;
  const hostnames = [...new Set(currentDebugRecords.map((record) => record.hostname))].sort();
  select.replaceChildren(createOption("", "全部站点"), ...hostnames.map((host) => createOption(host, host)));
  select.value = hostnames.includes(value) ? value : "";
}

function renderDebugRecords(): void {
  const selected = byId<HTMLSelectElement>("debug-filter").value;
  const records = currentDebugRecords.filter((record) => !selected || record.hostname === selected);
  const container = byId("debug-records");
  if (records.length === 0) return void container.replaceChildren(createEmpty("暂无调试记录。"));
  container.replaceChildren(...records.map((record) => {
    const item = document.createElement("article");
    item.className = "debug-item";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = getCategoryDefinition(record.category).label;
    const url = document.createElement("p");
    url.textContent = record.targetUrl;
    const meta = document.createElement("div");
    meta.className = "debug-meta";
    meta.append(
      badge(renderDisposition(record.disposition), record.applied ? "success" : "info"),
      badge(record.applied ? "已应用" : record.bypassReason ?? "未改写", record.applied ? "success" : "warning"),
      badge(renderDecisionSource(record.resolvedBy), "info"),
    );
    copy.append(title, url, meta);
    const actions = document.createElement("div");
    actions.className = "debug-actions";
    const createRule = document.createElement("button");
    createRule.type = "button";
    createRule.className = "secondary-button";
    createRule.textContent = "预填页面规则";
    createRule.addEventListener("click", () => prefillPageRule(record));
    const simulate = document.createElement("button");
    simulate.type = "button";
    simulate.className = "secondary-button";
    simulate.textContent = "模拟";
    simulate.addEventListener("click", () => void simulateDebugRecord(record));
    actions.append(createRule, simulate);
    item.append(copy, actions);
    return item;
  }));
}

function prefillPageRule(record: NavigationDebugRecord): void {
  selectWorkspace("personal", true);
  openPersonalEditor();
  byId<HTMLInputElement>("personal-name").value = `调试例外：${getCategoryDefinition(record.category).label}`;
  byId<HTMLSelectElement>("personal-scope-type").value = "page";
  byId<HTMLInputElement>("personal-hostname").value = record.hostname;
  byId<HTMLInputElement>("personal-page-key").value = record.pageUrl;
  setMatcherFields("source", { kind: "exact", value: record.pageUrl });
  setMatcherFields("target", { kind: "exact", value: record.targetUrl });
  setChoiceValues("personal-triggers", [record.trigger]);
  setChoiceValues("personal-semantics", semanticsFromEvidence(record.evidence));
  selectRiskContext(record.hostname);
  syncPersonalScopeFields();
  byId<HTMLFormElement>("personal-rule-editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function simulateDebugRecord(record: NavigationDebugRecord): Promise<void> {
  const relation = evidenceValue(record.evidence, "relation") as NavigationRelation | undefined;
  const method = evidenceValue(record.evidence, "method");
  const semantics = semanticsFromEvidence(record.evidence);
  byId<HTMLInputElement>("simulator-source-url").value = record.pageUrl;
  byId<HTMLInputElement>("simulator-target-url").value = record.targetUrl;
  setSelect("simulator-trigger", record.trigger);
  setSelect("simulator-relation", relation ?? inferRelation(record.pageUrl, record.targetUrl));
  setChoiceValues("simulator-semantics", semantics.length ? semantics : ["unknown"]);
  setSelect("simulator-native-target", record.nativeDisposition === "new-tab" ? "blank" : "self");
  setSelect("simulator-native-disposition", record.nativeDisposition);
  byId<HTMLInputElement>("simulator-form-method").value = method ?? "";
  setSelect("simulator-user-intent", record.trigger === "window.open" ? "script-active" : "plain");
  const capabilityBlocked = record.resolvedBy === "capability";
  byId<HTMLInputElement>("simulator-can-rewrite").checked = !capabilityBlocked;
  setSelect("simulator-risk", capabilityBlocked ? "hard-blocked" : record.resolvedBy === "risk" ? "sensitive" : "normal");
  byId<HTMLInputElement>("simulator-blockers").value = capabilityBlocked ? record.bypassReason ?? record.reason : "";
  byId<HTMLInputElement>("simulator-protocol").value = safeProtocol(record.targetUrl);
  byId("navigation-simulator").scrollIntoView({ behavior: "smooth", block: "start" });
  await runNavigationSimulation();
}

async function clearDebugRecords(): Promise<void> {
  try {
    await send({ type: "plm:clear-debug-records" });
    currentDebugRecords = [];
    renderDebugFilter();
    renderDebugRecords();
    setStatus("调试记录已清空。", "success");
  } catch (error) {
    setStatus(`清空失败：${getErrorMessage(error)}。现有记录已保留，可重试。`, "error");
  }
}

function renderPageRules(state: ExtensionState): void {
  const container = byId("page-rules");
  const entries = Object.entries(state.pageRules).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return void container.replaceChildren(createEmpty("暂无页面整体规则。"));
  container.replaceChildren(...entries.map(([url, mode]) => {
    const item = document.createElement("article");
    item.className = "page-rule-item";
    const copy = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = renderDisposition(mode);
    const path = document.createElement("p"); path.textContent = url;
    copy.append(title, path);
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "secondary-button"; remove.textContent = "删除";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      void removePageRule(url);
    });
    item.tabIndex = 0;
    item.addEventListener("click", () => prefillPageOverallRule(url, mode));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter") prefillPageOverallRule(url, mode);
    });
    item.append(copy, remove); return item;
  }));
}

async function savePageRule(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const input = byId<HTMLInputElement>("page-rule-url");
  const normalized = normalizeHttpPage(input.value);
  if (!normalized) {
    return setStatus("页面 URL 无效，仅支持 http/https。输入内容已保留，请修正后重试。", "error");
  }
  const mode = byId<HTMLSelectElement>("page-rule-mode").value as NavigationDisposition;
  try {
    currentState = await send<ExtensionState>({ type: "plm:set-page-rule", url: normalized.url, mode });
    if (editingPageRuleUrl && editingPageRuleUrl !== normalized.url) {
      currentState = await send<ExtensionState>({ type: "plm:remove-page-rule", url: editingPageRuleUrl });
    }
    renderAll();
    resetPageRuleForm();
    setStatus("页面整体规则已保存。", "success");
  } catch (error) {
    setStatus(`页面整体规则保存失败：${getErrorMessage(error)}。输入内容已保留，可重试。`, "error");
  }
}

function prefillPageOverallRule(url: string, mode: NavigationDisposition): void {
  editingPageRuleUrl = url;
  byId<HTMLInputElement>("page-rule-url").value = url;
  byId<HTMLSelectElement>("page-rule-mode").value = mode;
  byId<HTMLInputElement>("page-rule-url").focus();
}

function resetPageRuleForm(): void {
  editingPageRuleUrl = null;
  byId<HTMLFormElement>("page-rule-form").reset();
}

async function removePageRule(url: string): Promise<void> {
  try {
    currentState = await send<ExtensionState>({ type: "plm:remove-page-rule", url });
    renderAll();
    if (editingPageRuleUrl === url) resetPageRuleForm();
    setStatus("页面整体规则已删除。", "success");
  } catch (error) {
    setStatus(`页面整体规则删除失败：${getErrorMessage(error)}。规则仍保留，可重试。`, "error");
  }
}

async function exportConfiguration(): Promise<void> {
  if (!currentState) return;
  const backup: ConfigurationBackup = {
    formatVersion: 1,
    extensionVersion: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    state: currentState,
  };
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "pagelinkmode-backup.json"; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function importConfiguration(): Promise<void> {
  const input = byId<HTMLInputElement>("import-config-input");
  const file = input.files?.[0];
  if (!file) return;
  try {
    const value = JSON.parse(await file.text()) as unknown;
    currentState = await send<ExtensionState>({ type: "plm:replace-state", state: value });
    renderAll();
    input.value = "";
    setStatus("配置已导入；敏感规则保持关闭。", "success");
  } catch (error) { setStatus(`导入失败：${getErrorMessage(error)}`, "error"); }
}

function buildPersonalMatch(): PersonalRule["match"] {
  const source = readUrlMatcher("source");
  const target = readUrlMatcher("target");
  const relations = readChoiceValues<NavigationRelation>("personal-relations");
  const triggers = readChoiceValues<NavigationTrigger>("personal-triggers");
  const semantics = readChoiceValues<NavigationSemantic>("personal-semantics");
  const nativeTargets = readChoiceValues<NativeTargetKind>("personal-native-targets");
  const frameContexts = readChoiceValues<NavigationFrameContext>("personal-frame-contexts");
  const methods = uniqueValues([
    ...readChoiceValues<string>("personal-form-methods"),
    ...parseCommaSeparated(byId<HTMLInputElement>("personal-custom-form-methods").value),
  ].map((method) => method.toUpperCase()));
  const tag = byId<HTMLInputElement>("personal-element-tag").value.trim().toLowerCase();
  const selector = byId<HTMLInputElement>("personal-selector").value.trim();
  const attributes = readElementAttributes();
  const element = tag || selector || Object.keys(attributes).length
    ? { ...(tag ? { tag } : {}), ...(selector ? { selector } : {}), ...(Object.keys(attributes).length ? { attributes } : {}) }
    : undefined;
  return {
    ...(source ? { sourceUrl: source } : {}), ...(target ? { targetUrl: target } : {}),
    ...(relations.length ? { relations } : {}), ...(triggers.length ? { triggers } : {}),
    ...(semantics.length ? { semantics } : {}), ...(nativeTargets.length ? { nativeTargets } : {}),
    ...(frameContexts.length ? { frameContexts } : {}), ...(methods.length ? { formMethods: methods } : {}),
    ...(element ? { element } : {}),
  };
}

function readUrlMatcher(prefix: "source" | "target") {
  const kind = byId<HTMLSelectElement>(`personal-${prefix}-kind`).value as UrlMatcherKind | "";
  const value = byId<HTMLInputElement>(`personal-${prefix}-value`).value.trim();
  return kind && value ? { kind, value } : undefined;
}

function setMatcherFields(prefix: "source" | "target", matcher?: { kind: UrlMatcherKind; value: string }): void {
  setSelect(`personal-${prefix}-kind`, matcher?.kind ?? "");
  byId<HTMLInputElement>(`personal-${prefix}-value`).value = matcher?.value ?? "";
}

function syncPersonalScopeFields(): void {
  const page = byId<HTMLSelectElement>("personal-scope-type").value === "page";
  byId("personal-page-row").hidden = !page;
  byId<HTMLInputElement>("personal-page-key").required = page;
}

function populateChoiceGroups(): void {
  createChoiceGroup("personal-relations", RELATION_OPTIONS);
  createChoiceGroup("personal-triggers", TRIGGER_OPTIONS);
  createChoiceGroup("personal-semantics", SEMANTICS.map((semantic) => [semantic, SEMANTIC_LABELS[semantic]]));
  createChoiceGroup("personal-native-targets", NATIVE_TARGET_OPTIONS);
  createChoiceGroup("personal-frame-contexts", FRAME_CONTEXT_OPTIONS);
  createChoiceGroup("personal-form-methods", FORM_METHOD_OPTIONS);
  createChoiceGroup("simulator-semantics", SEMANTICS.map((semantic) => [semantic, SEMANTIC_LABELS[semantic]]));
}

function createChoiceGroup(containerId: string, options: Array<[string, string]>): void {
  const container = byId(containerId);
  container.replaceChildren(...options.map(([value, labelText]) => {
    const label = document.createElement("label");
    label.className = "choice-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    const text = document.createElement("span");
    text.textContent = labelText;
    label.append(input, text);
    return label;
  }));
}

function setChoiceValues(containerId: string, values: readonly string[]): void {
  const selected = new Set(values);
  byId(containerId).querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function readChoiceValues<T extends string>(containerId: string): T[] {
  return [...byId(containerId).querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')]
    .map((input) => input.value as T);
}

function renderAttributeRows(attributes?: Record<string, string>): void {
  const container = byId("personal-attributes");
  container.replaceChildren();
  Object.entries(attributes ?? {}).forEach(([name, value]) => addAttributeRow(name, value));
}

function addAttributeRow(name = "", value = ""): void {
  const row = document.createElement("div");
  row.className = "attribute-row";
  const nameInput = document.createElement("input");
  nameInput.dataset.attributeRole = "name";
  nameInput.placeholder = "属性名，例如 data-kind";
  nameInput.setAttribute("aria-label", "属性名");
  nameInput.value = name;
  const valueInput = document.createElement("input");
  valueInput.dataset.attributeRole = "value";
  valueInput.placeholder = "精确值";
  valueInput.setAttribute("aria-label", "属性值");
  valueInput.value = value;
  const remove = iconButton("删除属性", "×", () => row.remove());
  row.append(nameInput, valueInput, remove);
  byId("personal-attributes").appendChild(row);
  if (!name) nameInput.focus();
}

function readElementAttributes(): Record<string, string> {
  const attributes: Record<string, string> = {};
  byId("personal-attributes").querySelectorAll<HTMLElement>(".attribute-row").forEach((row) => {
    const name = row.querySelector<HTMLInputElement>('[data-attribute-role="name"]')?.value.trim().toLowerCase();
    const value = row.querySelector<HTMLInputElement>('[data-attribute-role="value"]')?.value ?? "";
    if (name) attributes[name] = value;
  });
  return attributes;
}

function resetSimulator(): void {
  byId<HTMLFormElement>("simulator-form").reset();
  setChoiceValues("simulator-semantics", ["content"]);
  byId("simulator-result").hidden = true;
}

async function runNavigationSimulation(event?: SubmitEvent): Promise<void> {
  event?.preventDefault();
  const sourceUrl = byId<HTMLInputElement>("simulator-source-url").value.trim();
  const targetUrl = byId<HTMLInputElement>("simulator-target-url").value.trim();
  const semantics = readChoiceValues<NavigationSemantic>("simulator-semantics");
  if (!sourceUrl || !targetUrl) return setStatus("规则模拟器需要来源 URL 和目标 URL。", "error");
  if (!semantics.length) return setStatus("规则模拟器至少需要一个语义。", "error");
  const formMethod = byId<HTMLInputElement>("simulator-form-method").value.trim().toUpperCase();
  const blockers = parseCommaSeparated(byId<HTMLInputElement>("simulator-blockers").value);
  const relation = byId<HTMLSelectElement>("simulator-relation").value as NavigationRelation;
  const facts: NavigationFacts = {
    trigger: byId<HTMLSelectElement>("simulator-trigger").value as NavigationTrigger,
    sourceUrl,
    targetUrl,
    relation,
    protocol: normalizeProtocol(byId<HTMLInputElement>("simulator-protocol").value, targetUrl),
    semantics,
    nativeTarget: byId<HTMLSelectElement>("simulator-native-target").value as NativeTargetKind,
    nativeDisposition: byId<HTMLSelectElement>("simulator-native-disposition").value as NavigationDisposition,
    frameContext: byId<HTMLSelectElement>("simulator-frame-context").value as NavigationFrameContext,
    userIntent: byId<HTMLSelectElement>("simulator-user-intent").value as NavigationUserIntent,
    ...(formMethod ? { formMethod } : {}),
    evidence: [
      `relation:${relation}`,
      ...semantics.map((semantic) => `semantic:${semantic}`),
      ...(formMethod ? [`method:${formMethod}`] : []),
      ...blockers.map((blocker) => `blocker:${blocker}`),
    ],
    capability: {
      canRewrite: byId<HTMLInputElement>("simulator-can-rewrite").checked,
      risk: byId<HTMLSelectElement>("simulator-risk").value as NavigationFacts["capability"]["risk"],
      blockers,
    },
  };
  try {
    // 模拟器复用后台正式决策链，避免 Options 维护一套会漂移的规则实现。
    const decision = await send<NavigationDecision>({ type: "plm:simulate-navigation", facts });
    renderSimulationResult(decision);
  } catch (error) {
    setStatus(`模拟失败：${getErrorMessage(error)}`, "error");
  }
}

function renderSimulationResult(decision: NavigationDecision): void {
  const result = byId("simulator-result");
  const summary = byId("simulator-summary");
  const values: Array<[string, string]> = [
    ["分类", getCategoryDefinition(decision.category).label],
    ["期望动作", renderDisposition(decision.requestedDisposition)],
    ["原生动作", renderDisposition(decision.nativeDisposition)],
    ["最终动作", renderDisposition(decision.disposition)],
    ["是否应用", decision.applied ? "已应用" : "未应用"],
    ["旁路原因", decision.bypassReason ?? "无"],
    ["命中规则", decision.winningRuleId ?? "无"],
  ];
  summary.replaceChildren(...values.map(([label, value]) => {
    const item = document.createElement("div");
    const key = document.createElement("span");
    key.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value;
    item.append(key, content);
    return item;
  }));

  const winningIndex = DECISION_CHAIN.findIndex((stage) => stage.source === decision.resolvedBy);
  byId("simulator-trace").replaceChildren(...DECISION_CHAIN.map((stage, index) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = stage.label;
    const status = document.createElement("strong");
    const isGate = stage.source === "capability" || stage.source === "disabled" || stage.source === "risk";
    const state = index === winningIndex ? "matched" : index < winningIndex ? "passed" : "skipped";
    item.dataset.state = state;
    status.textContent = state === "matched" ? "命中" : state === "passed" ? (isGate ? "已通过" : "未命中") : "未继续";
    item.append(label, status);
    return item;
  }));
  result.hidden = false;
}

function parseCommaSeparated(value: string): string[] {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

function uniqueValues<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function semanticsFromEvidence(evidence: string[]): NavigationSemantic[] {
  const known = new Set<string>(SEMANTICS);
  return uniqueValues(evidence
    .filter((item) => item.startsWith("semantic:"))
    .map((item) => item.slice("semantic:".length))
    .filter((item): item is NavigationSemantic => known.has(item)));
}

function evidenceValue(evidence: string[], prefix: string): string | undefined {
  return evidence.find((item) => item.startsWith(`${prefix}:`))?.slice(prefix.length + 1);
}

function inferRelation(sourceUrl: string, targetUrl: string): NavigationRelation {
  try {
    const source = new URL(sourceUrl);
    const target = new URL(targetUrl);
    if (source.href === target.href) return "same-document";
    if (source.origin === target.origin) return "same-origin";
    return source.hostname === target.hostname ? "same-site" : "cross-site";
  } catch {
    return "cross-site";
  }
}

function safeProtocol(url: string): string {
  try { return new URL(url).protocol; } catch { return "https:"; }
}

function normalizeProtocol(value: string, targetUrl: string): string {
  const protocol = value.trim() || safeProtocol(targetUrl);
  return protocol.endsWith(":") ? protocol : `${protocol}:`;
}

function createActionGroup(
  id: string | undefined,
  options: Array<[string, string]>,
  selected: string,
  onSelect: (value: never) => void,
  disabled = false,
): HTMLElement {
  const group = document.createElement("div");
  if (id) group.id = id;
  group.className = "action-group";
  group.style.setProperty("--option-count", String(options.length));
  group.setAttribute("aria-disabled", String(disabled));
  options.forEach(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button"; button.dataset.value = value; button.textContent = label; button.disabled = disabled;
    button.addEventListener("click", () => { syncActionSelection(group, value); onSelect(value as never); });
    group.appendChild(button);
  });
  syncActionSelection(group, selected);
  return group;
}

function syncActionSelection(group: HTMLElement, value: string): void {
  group.dataset.value = value;
  group.querySelectorAll<HTMLButtonElement>("button[data-value]").forEach((button) => { button.dataset.selected = String(button.dataset.value === value); });
}

function getActionSelection(group: HTMLElement): NavigationDisposition {
  const value = group.dataset.value;
  return value === "same-tab" || value === "new-tab" ? value : "preserve-native";
}

function collectSiteKeys(state: ExtensionState): string[] {
  return [...new Set([
    ...Object.keys(state.siteRules), ...Object.keys(state.siteCategoryRules), ...state.disabledSites,
    ...state.personalRules.map((rule) => rule.scope.hostname), ...manuallyAddedSites,
  ])].sort();
}

function nextRuleOrder(scope: PersonalRule["scope"]): number {
  const scopeKey = getPersonalScopeKey(scope);
  const orders = currentState?.personalRules
    .filter((rule) => getPersonalScopeKey(rule.scope) === scopeKey)
    .map((rule) => rule.order) ?? [];
  return orders.length ? Math.max(...orders) + 1 : 0;
}

function comparePersonalRules(a: PersonalRule, b: PersonalRule): number {
  if (a.scope.type !== b.scope.type) return a.scope.type === "page" ? -1 : 1;
  return getPersonalScopeKey(a.scope).localeCompare(getPersonalScopeKey(b.scope)) || a.order - b.order;
}

function hasSamePersonalScope(left: PersonalRule | undefined, right: PersonalRule): boolean {
  return left !== undefined && getPersonalScopeKey(left.scope) === getPersonalScopeKey(right.scope);
}

function getPersonalScopeKey(scope: PersonalRule["scope"]): string {
  return scope.type === "page" ? `page:${scope.pageKey}` : `site:${scope.hostname}`;
}

function hasRiskGrant(hostname: string): boolean { return currentRiskGrants.some((grant) => grant.hostname === hostname); }
function selectRiskContext(value: string): void {
  selectedRiskHostname = normalizeHostname(value) || null;
  renderRiskState();
}
function clearRiskContext(): void {
  selectedRiskHostname = null;
  renderRiskState();
}
function normalizeHttpPage(value: string): { url: string; hostname: string } | null {
  const rawUrl = value.trim();
  if (!rawUrl || !isSupportedPageUrl(rawUrl)) return null;
  try {
    const url = normalizePageUrl(rawUrl);
    return { url, hostname: normalizeHostname(getHostname(url)) };
  } catch {
    return null;
  }
}
function normalizeHostname(value: string): string {
  const candidate = value.trim();
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}
function isWorkspaceView(value: string): value is WorkspaceView { return ["basic", "sites", "personal", "debug", "pages", "backup"].includes(value); }
function selectWorkspace(view: WorkspaceView, updateUrl: boolean): void {
  document.querySelectorAll<HTMLButtonElement>("[data-workspace-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.workspaceTab === view)));
  document.querySelectorAll<HTMLElement>("[data-workspace-view]").forEach((panel) => { panel.hidden = panel.dataset.workspaceView !== view; });
  if (updateUrl) history.replaceState(null, "", `?view=${view}`);
}
function setSelect(id: string, value: string): void { byId<HTMLSelectElement>(id).value = value; }
function createOption(value: string, label: string): HTMLOptionElement { const option = document.createElement("option"); option.value = value; option.textContent = label; return option; }
function createEmpty(text: string): HTMLElement { const element = document.createElement("p"); element.className = "empty-state"; element.textContent = text; return element; }
function badge(text: string, tone: string): HTMLElement { const element = document.createElement("span"); element.className = "status-badge"; element.dataset.tone = tone; element.textContent = text; return element; }
function iconButton(title: string, text: string, onClick: () => void): HTMLButtonElement { const button = document.createElement("button"); button.type = "button"; button.className = "icon-button"; button.title = title; button.setAttribute("aria-label", title); button.textContent = text; button.addEventListener("click", onClick); return button; }
function renderDisposition(value: NavigationDisposition): string { return value === "same-tab" ? "同标签" : value === "new-tab" ? "新标签" : "保持原生"; }
function renderRuleMode(value: RuleMode): string { return value === "inherit" ? "继承" : renderDisposition(value); }
function renderDecisionSource(value: NavigationDebugRecord["resolvedBy"]): string { return ({ "personal-page": "页面个性化", page: "页面整体", "personal-site": "站点个性化", site: "站点整体", "site-category": "站点分类", "global-category": "全局分类", capability: "技术边界", risk: "风险门禁", disabled: "站点停用", "native-fallback": "原生兜底" } as Record<string, string>)[value] ?? value; }
function setStatus(message: string, tone: "success" | "error"): void { const element = byId("config-status"); element.hidden = false; element.textContent = message; element.dataset.tone = tone; }
function getErrorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function send<T = RuntimeResponse>(message: Record<string, unknown>): Promise<T> {
  const response = await chrome.runtime.sendMessage(message as RuntimeRequest) as RuntimeResponse;
  if (typeof response === "object" && response !== null && "ok" in response && response.ok === false) throw new Error(response.error);
  return response as T;
}
