import "./styles/base.css";
import "./styles/popup.css";

import type { RuntimeRequest, RuntimeResponse } from "./lib/messages";
import type {
  BasicPresetId,
  ExtensionState,
  NavigationDebugRecord,
  NavigationDisposition,
  PopupContext,
  RuleMode,
  TakeoverScopeLevel,
} from "./lib/types";
import {
  scheduleTakeoverScopeRangeRecovery,
  syncTakeoverScopeRange,
} from "./lib/scope-control";
import { normalizePageUrl } from "./lib/url";

const PRESETS: Array<{ id: Exclude<BasicPresetId, "custom">; label: string; description: string }> = [
  { id: "precise", label: "精准", description: "仅普通同源内容" },
  { id: "content", label: "内容", description: "加入常用内容入口" },
  { id: "broad", label: "适中", description: "覆盖多数日常浏览（推荐）" },
  { id: "deep", label: "深入", description: "加入筛选、相册和 GET 表单" },
  { id: "widest", label: "最广", description: "加入翻页和脚本打开" },
];
const PRESET_BY_LEVEL = PRESETS.map((preset) => preset.id);

let activeTab: chrome.tabs.Tab | null = null;
let currentContext: PopupContext | null = null;
let latestDecision: NavigationDebugRecord | null = null;
let currentPresetId: BasicPresetId = "broad";
let selectedPreset: Exclude<BasicPresetId, "custom"> = "broad";
let lastSuccessfulPreset: Exclude<BasicPresetId, "custom"> = "broad";
let pendingPreset: Exclude<BasicPresetId, "custom"> | null = null;
let presetApplyInFlight = false;
let presetApplySequence = 0;
let cancelPresetRangeRecovery: (() => void) | null = null;
let hideStatusTimer: number | undefined;

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少界面元素 #${id}`);
  return element as T;
};

document.addEventListener("DOMContentLoaded", () => {
  bindActions();
  void initialize();
});

window.addEventListener("pageshow", () => beginPresetRangeRecovery(selectedPreset));

function bindActions(): void {
  byId<HTMLButtonElement>("open-options").addEventListener("click", () => void chrome.runtime.openOptionsPage());
  byId<HTMLButtonElement>("site-enabled").addEventListener("click", () => void toggleSiteEnabled());
  byId<HTMLButtonElement>("open-personal-rules").addEventListener("click", () => void openPersonalRules("page"));
  byId<HTMLButtonElement>("open-site-personal").addEventListener("click", () => void openPersonalRules("site"));
  byId<HTMLButtonElement>("open-page-personal").addEventListener("click", () => void openPersonalRules("page"));
  const presetRange = byId<HTMLInputElement>("popup-preset-range");
  presetRange.addEventListener("pointerdown", stopPresetRangeRecovery);
  presetRange.addEventListener("keydown", stopPresetRangeRecovery);
  presetRange.addEventListener("input", () => {
    stopPresetRangeRecovery();
    const preset = readPresetRangeValue(presetRange);
    if (preset) {
      selectedPreset = preset;
      queuePresetApplication(preset);
      renderPresetControl(preset);
    }
  });
  byId("site-rule-actions").replaceWith(createActionGroup("site-rule-actions", (mode) => void setSiteRule(mode)));
  byId("page-rule-actions").replaceWith(createActionGroup("page-rule-actions", (mode) => void setPageRule(mode)));
}

async function initialize(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab ?? null;
    if (!tab?.url) return renderUnsupported();
    const [context, records, state] = await Promise.all([
      send<PopupContext>({ type: "plm:get-popup-context", url: tab.url }),
      send<NavigationDebugRecord[]>({ type: "plm:get-debug-records" }).catch(() => []),
      send<ExtensionState>({ type: "plm:get-state" }),
    ]);
    currentPresetId = state.presetId;
    selectedPreset = currentPresetId === "custom" ? "broad" : currentPresetId;
    lastSuccessfulPreset = selectedPreset;
    currentContext = context;
    latestDecision = records.find((record) => normalizePageUrl(record.pageUrl) === context.pageKey) ?? null;
    renderContext(currentContext);
  } catch (error) {
    renderUnsupported();
    showStatus(`读取失败：${getErrorMessage(error)}`, "error");
  }
}

function renderContext(context: PopupContext): void {
  if (!context.supported) return renderUnsupported();
  const band = byId("status-band");
  band.dataset.state = context.siteEnabled ? "managed" : "disabled";
  byId("status-label").textContent = context.siteEnabled ? "当前站点已托管" : "当前站点已停用";
  const toggle = byId<HTMLButtonElement>("site-enabled");
  toggle.disabled = false;
  toggle.setAttribute("aria-checked", String(context.siteEnabled));
  byId("host-value").textContent = context.hostname;
  byId("context-summary").textContent = context.siteEnabled
    ? renderContextSummary(context)
    : "所有规则已保留，当前页面按网站原生行为处理。";
  byId("decision-source").textContent = renderDecisionSummary(context, latestDecision);
  syncActionGroup(byId("site-rule-actions"), context.siteMode);
  syncActionGroup(byId("page-rule-actions"), context.pageMode);
  byId("site-rule-source").textContent = context.siteMode === "inherit" ? "继承基础分类" : renderRuleMode(context.siteMode);
  byId("page-rule-source").textContent = context.pageMode === "inherit" ? "继承站点" : renderRuleMode(context.pageMode);
  const personalCount = context.personalRules.filter((rule) =>
    rule.scope.hostname === context.hostname &&
    (rule.scope.type === "site" || rule.scope.pageKey === context.pageKey),
  ).length;
  byId("personal-rule-count").textContent = `当前范围 ${personalCount} 条`;
  renderPresetControl(selectedPreset);
  beginPresetRangeRecovery(selectedPreset);
}

function renderUnsupported(): void {
  const band = byId("status-band");
  band.dataset.state = "unsupported";
  byId("status-label").textContent = "当前页面不可用";
  byId("host-value").textContent = "浏览器受限页面";
  byId("context-summary").textContent = "PageLinkMode 只处理可注入的普通 HTTP/HTTPS 页面。";
  byId("decision-source").textContent = "当前命中来源：浏览器技术限制";
  byId<HTMLButtonElement>("site-enabled").disabled = true;
  byId<HTMLButtonElement>("open-personal-rules").disabled = true;
  byId<HTMLButtonElement>("open-site-personal").disabled = true;
  byId<HTMLButtonElement>("open-page-personal").disabled = true;
  byId<HTMLInputElement>("popup-preset-range").disabled = true;
  document.querySelectorAll<HTMLButtonElement>(".action-group button").forEach((button) => { button.disabled = true; });
}

async function toggleSiteEnabled(): Promise<void> {
  if (!currentContext) return;
  try {
    await send({ type: "plm:set-site-enabled", hostname: currentContext.hostname, enabled: !currentContext.siteEnabled });
    await refreshAfterRuleChange();
  } catch (error) { showStatus(`保存失败：${getErrorMessage(error)}`, "error"); }
}

async function setSiteRule(mode: RuleMode): Promise<void> {
  if (!currentContext) return;
  try {
    await send({ type: "plm:set-site-rule", hostname: currentContext.hostname, mode });
    await refreshAfterRuleChange();
  } catch (error) { showStatus(`保存失败：${getErrorMessage(error)}`, "error"); }
}

async function setPageRule(mode: RuleMode): Promise<void> {
  if (!currentContext) return;
  try {
    await send({ type: "plm:set-page-rule", url: currentContext.url, mode });
    await refreshAfterRuleChange();
  } catch (error) { showStatus(`保存失败：${getErrorMessage(error)}`, "error"); }
}

async function refreshAfterRuleChange(): Promise<void> {
  if (!currentContext) return;
  currentContext = await send<PopupContext>({ type: "plm:get-popup-context", url: currentContext.url });
  latestDecision = null;
  renderContext(currentContext);
  if (activeTab?.id !== undefined) await chrome.tabs.reload(activeTab.id);
  showStatus("规则已保存。", "success");
}

async function openPersonalRules(scope: "site" | "page"): Promise<void> {
  if (!currentContext) return;
  const url = new URL(chrome.runtime.getURL("src/options.html"));
  url.searchParams.set("view", "personal");
  url.searchParams.set("hostname", currentContext.hostname);
  url.searchParams.set("scope", scope);
  if (scope === "page") url.searchParams.set("page", currentContext.pageKey);
  await chrome.tabs.create({ url: url.toString() });
  window.close();
}

function queuePresetApplication(preset: Exclude<BasicPresetId, "custom">): void {
  pendingPreset = preset;
  presetApplySequence += 1;
  if (!presetApplyInFlight) void drainPresetApplications();
}

async function drainPresetApplications(): Promise<void> {
  if (presetApplyInFlight) return;
  presetApplyInFlight = true;
  try {
    while (pendingPreset) {
      const preset = pendingPreset;
      pendingPreset = null;
      const sequence = presetApplySequence;
      try {
        const state = await send<ExtensionState>({ type: "plm:apply-preset", presetId: preset });
        lastSuccessfulPreset = preset;

        // 拖动期间可能已经产生了更新的请求；旧响应只保留为可回退档，不再覆盖当前 UI。
        if (sequence !== presetApplySequence) continue;
        currentPresetId = state.presetId;
        selectedPreset = state.presetId === "custom" ? preset : state.presetId;
        const refreshError = await refreshAfterPresetApply(sequence, preset);
        if (sequence !== presetApplySequence) continue;
        showStatus(refreshError ? `预设已保存，刷新失败：${refreshError}` : "预设已应用。", refreshError ? "error" : "success");
      } catch (error) {
        if (sequence !== presetApplySequence) continue;
        pendingPreset = null;
        currentPresetId = lastSuccessfulPreset;
        selectedPreset = lastSuccessfulPreset;
        renderPresetControl(lastSuccessfulPreset);
        beginPresetRangeRecovery(lastSuccessfulPreset);
        showStatus(`预设应用失败：${getErrorMessage(error)}。已回退到${PRESETS.find((item) => item.id === lastSuccessfulPreset)!.label}。`, "error");
      }
    }
  } finally {
    presetApplyInFlight = false;
    if (pendingPreset) void drainPresetApplications();
  }
}

async function refreshAfterPresetApply(
  sequence: number,
  preset: Exclude<BasicPresetId, "custom">,
): Promise<string | null> {
  if (!currentContext) {
    renderPresetControl(preset);
    return null;
  }
  try {
    const context = await send<PopupContext>({ type: "plm:get-popup-context", url: currentContext.url });
    if (sequence !== presetApplySequence) return null;
    currentContext = context;
    renderContext(currentContext);
    return null;
  } catch (error) {
    // 写入已经成功时不回滚配置；保留已应用档位并把刷新异常反馈给用户。
    if (sequence === presetApplySequence) renderPresetControl(preset);
    return getErrorMessage(error);
  }
}

function renderPresetControl(preset: Exclude<BasicPresetId, "custom">): void {
  const definition = PRESETS.find((candidate) => candidate.id === preset)!;
  const level = PRESET_BY_LEVEL.indexOf(preset) as TakeoverScopeLevel;
  const range = byId<HTMLInputElement>("popup-preset-range");
  syncTakeoverScopeRange(range, level);
  const isCurrent = currentPresetId !== "custom" && currentPresetId === preset;
  const stateLabel = isCurrent ? "当前已应用" : presetApplyInFlight ? "正在应用" : "自定义配置";
  range.setAttribute("aria-valuetext", `${definition.label}：${definition.description}，${stateLabel}`);
  byId<HTMLOutputElement>("popup-preset-label").value = isCurrent
    ? `当前：${definition.label}`
    : currentPresetId === "custom"
      ? `自定义 · 待选${definition.label}`
      : `待选：${definition.label}`;
}

function beginPresetRangeRecovery(preset: Exclude<BasicPresetId, "custom">): void {
  stopPresetRangeRecovery();
  cancelPresetRangeRecovery = scheduleTakeoverScopeRangeRecovery(
    byId<HTMLInputElement>("popup-preset-range"),
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

function createActionGroup(id: string, onSelect: (mode: RuleMode) => void): HTMLElement {
  const group = document.createElement("div");
  group.id = id;
  group.className = "action-group";
  const options: Array<[RuleMode, string]> = [
    ["inherit", "继承"], ["same-tab", "同标签"], ["new-tab", "新标签"], ["preserve-native", "原生"],
  ];
  options.forEach(([mode, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.value = mode;
    button.textContent = label;
    button.addEventListener("click", () => onSelect(mode));
    group.appendChild(button);
  });
  return group;
}

function syncActionGroup(group: HTMLElement, selected: RuleMode): void {
  group.querySelectorAll<HTMLButtonElement>("button[data-value]").forEach((button) => {
    button.dataset.selected = String(button.dataset.value === selected);
    button.disabled = !currentContext?.siteEnabled;
  });
}

function renderContextSummary(context: PopupContext): string {
  if (context.pageMode !== "inherit") return `当前页面整体使用${renderRuleMode(context.pageMode)}。`;
  if (context.siteMode !== "inherit") return `当前站点整体使用${renderRuleMode(context.siteMode)}。`;
  return "当前页面按基础分类和个性化例外处理。";
}

function renderDecisionSummary(context: PopupContext, record: NavigationDebugRecord | null): string {
  if (record) {
    return `最近命中：${renderDecisionSource(record.resolvedBy)} · ${renderRuleMode(record.disposition)}`;
  }
  const source = context.effectiveSource === "page"
    ? "页面整体"
    : context.effectiveSource === "site"
      ? "站点整体"
      : context.effectiveSource === "disabled"
        ? "站点停用"
        : "基础分类或个性化规则";
  return `当前命中来源：${source}（尚无本页跳转记录）`;
}

function renderDecisionSource(source: NavigationDebugRecord["resolvedBy"]): string {
  return ({
    "personal-page": "页面个性化",
    page: "页面整体",
    "personal-site": "站点个性化",
    site: "站点整体",
    "site-category": "站点分类",
    "global-category": "全局分类",
    capability: "技术边界",
    risk: "风险门禁",
    disabled: "站点停用",
    "native-fallback": "原生兜底",
  } as const)[source];
}

function renderRuleMode(mode: RuleMode): string {
  if (mode === "inherit") return "继承";
  return mode === "same-tab" ? "同标签" : mode === "new-tab" ? "新标签" : "保持原生";
}

function showStatus(message: string, tone: "success" | "error"): void {
  const element = byId("popup-status");
  if (hideStatusTimer !== undefined) window.clearTimeout(hideStatusTimer);
  element.hidden = false;
  element.textContent = message;
  element.title = message;
  element.dataset.tone = tone;
  // 状态带承担短时反馈，既保留可见错误提示，也不改变 Popup 的文档高度。
  hideStatusTimer = window.setTimeout(() => {
    element.hidden = true;
    hideStatusTimer = undefined;
  }, tone === "success" ? 1_800 : 4_000);
}

function getErrorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function send<T = RuntimeResponse>(message: Record<string, unknown>): Promise<T> {
  const response = await chrome.runtime.sendMessage(message as RuntimeRequest) as RuntimeResponse;
  if (typeof response === "object" && response !== null && "ok" in response && response.ok === false) throw new Error(response.error);
  return response as T;
}
