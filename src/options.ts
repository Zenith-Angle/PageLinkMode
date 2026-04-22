import "./styles/base.css";
import "./styles/options.css";

import {
  getCategoryDefinition,
  NAVIGATION_CATEGORY_DEFINITIONS,
} from "./lib/navigation-categories";
import type { RuntimeRequest, RuntimeResponse } from "./lib/messages";
import type {
  ExtensionState,
  NavigationCategory,
  NavigationDebugRecord,
  NavigationDisposition,
  NavigationMode,
  SiteCategoryRule,
} from "./lib/types";

const categoryCount = document.querySelector<HTMLElement>("#category-count");
const siteCount = document.querySelector<HTMLElement>("#site-count");
const pageCount = document.querySelector<HTMLElement>("#page-count");
const globalCategoryRules = document.querySelector<HTMLElement>("#global-category-rules");
const siteRuleCards = document.querySelector<HTMLElement>("#site-rule-cards");
const pageRules = document.querySelector<HTMLElement>("#page-rules");
const exportConfigButton = document.querySelector<HTMLButtonElement>("#export-config");
const importConfigButton = document.querySelector<HTMLButtonElement>("#import-config");
const importConfigInput = document.querySelector<HTMLInputElement>("#import-config-input");
const configStatus = document.querySelector<HTMLElement>("#config-status");
const debugRecordsContainer = document.querySelector<HTMLElement>("#debug-records");
const debugFilter = document.querySelector<HTMLSelectElement>("#debug-filter");
const clearDebugRecordsButton = document.querySelector<HTMLButtonElement>("#clear-debug-records");

let currentState: ExtensionState | null = null;
let currentDebugRecords: NavigationDebugRecord[] = [];

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  void loadDashboard();
});

function bindEvents(): void {
  exportConfigButton?.addEventListener("click", () => {
    void exportState();
  });
  importConfigButton?.addEventListener("click", () => {
    importConfigInput?.click();
  });
  importConfigInput?.addEventListener("change", () => {
    void importStateFromFile();
  });
  clearDebugRecordsButton?.addEventListener("click", () => {
    void clearDebugRecords();
  });
  debugFilter?.addEventListener("change", () => {
    renderDebugRecords(currentDebugRecords);
  });
}

async function loadDashboard(): Promise<void> {
  const [state, debugRecords] = await Promise.all([getState(), getDebugRecords()]);
  currentState = state;
  currentDebugRecords = debugRecords;
  renderState(state);
  renderDebugRecords(debugRecords);
}

function renderState(state: ExtensionState): void {
  const siteKeys = collectSiteKeys(state);
  categoryCount!.textContent = `${NAVIGATION_CATEGORY_DEFINITIONS.length} 类`;
  siteCount!.textContent = `${siteKeys.length} 个`;
  pageCount!.textContent = `${Object.keys(state.pageRules).length} 条`;

  renderGlobalCategoryRules(state);
  renderSiteCards(state, siteKeys);
  renderPageRules(state);
}

function renderGlobalCategoryRules(state: ExtensionState): void {
  globalCategoryRules!.innerHTML = "";
  NAVIGATION_CATEGORY_DEFINITIONS.forEach((definition) => {
    const row = document.createElement("article");
    row.className = "matrix-row";

    const copy = document.createElement("div");
    copy.className = "matrix-copy";
    copy.innerHTML = `
      <strong>${definition.label}</strong>
      <span>${definition.triggerLabel}</span>
      <p>${definition.description}</p>
    `;

    const actions = createActionGroup(
      [
        ["same-tab", "同标签页"],
        ["new-tab", "新标签页"],
        ["preserve-native", "保持原生"],
      ],
      state.globalCategoryRules[definition.id],
      (value) => {
        void updateGlobalCategoryRule(definition.id, value as NavigationDisposition);
      },
    );

    row.append(copy, actions);
    globalCategoryRules!.appendChild(row);
  });
}

function renderSiteCards(state: ExtensionState, siteKeys: string[]): void {
  siteRuleCards!.innerHTML = "";
  if (siteKeys.length === 0) {
    siteRuleCards!.appendChild(createEmptyState("暂无站点覆写。先在 popup 中为站点授权或保存站点规则，这里就会出现对应卡片。"));
    return;
  }

  siteKeys.forEach((hostname) => {
    const details = document.createElement("details");
    details.className = "site-card";
    details.dataset.hostname = hostname;

    const siteRule = state.siteRules[hostname] ?? "inherit";
    const siteCategoryRuleMap = state.siteCategoryRules[hostname] ?? {};
    const explicitCount = Object.keys(siteCategoryRuleMap).length;
    const siteEnabled = !state.disabledSites.includes(hostname);

    const summary = document.createElement("summary");
    summary.className = "site-card-summary";
    summary.innerHTML = `
      <div class="site-card-copy">
        <strong>${hostname}</strong>
        <p data-role="site-summary-text">${explicitCount > 0 ? `已配置 ${explicitCount} 条分类覆写` : "当前没有分类覆写，默认继承全局策略。"}</p>
      </div>
      <div class="site-card-chips">
        <span class="status-badge" data-tone="${siteEnabled ? "success" : "muted"}">${siteEnabled ? "已启用" : "已停用"}</span>
        <span class="status-badge" data-tone="info" data-role="site-rule-badge">${renderSiteRuleLabel(siteRule)}</span>
      </div>
    `;

    const body = document.createElement("div");
    body.className = "site-card-body";
    body.append(createSiteControlBar(hostname, siteEnabled, siteRule));

    const matrix = document.createElement("div");
    matrix.className = "site-matrix";
    NAVIGATION_CATEGORY_DEFINITIONS.forEach((definition) => {
      const row = document.createElement("article");
      row.className = "site-matrix-row";

      const copy = document.createElement("div");
      copy.className = "matrix-copy";
      copy.innerHTML = `
        <strong>${definition.label}</strong>
        <p>${definition.description}</p>
      `;

      const selectedRule = siteCategoryRuleMap[definition.id] ?? "inherit";
      const actions = createActionGroup(
        [
          ["inherit", "继承全局"],
          ["same-tab", "同标签页"],
          ["new-tab", "新标签页"],
          ["preserve-native", "保持原生"],
        ],
        selectedRule,
        (value) => {
          void updateSiteCategoryRule(hostname, definition.id, value as SiteCategoryRule);
        },
      );

      row.append(copy, actions);
      matrix.appendChild(row);
    });

    body.append(matrix);
    details.append(summary, body);
    siteRuleCards!.appendChild(details);
  });
}

function createSiteControlBar(
  hostname: string,
  siteEnabled: boolean,
  siteRule: NavigationMode | "inherit",
): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "site-control-bar";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "secondary-button";
  toggleButton.textContent = siteEnabled ? "停用当前站点" : "重新启用站点";
  toggleButton.addEventListener("click", () => {
    void toggleSiteEnabled(hostname, !siteEnabled);
  });

  const overallField = document.createElement("label");
  overallField.className = "control inline-control";
  overallField.innerHTML = `<span>站点整体规则</span>`;

  const select = document.createElement("select");
  select.innerHTML = `
    <option value="inherit">继承分类策略</option>
    <option value="same-tab">强制同标签页</option>
    <option value="new-tab">强制新标签页</option>
  `;
  select.value = siteRule;
  select.addEventListener("change", () => {
    void updateSiteRule(hostname, select.value as NavigationMode | "inherit");
  });
  overallField.appendChild(select);

  bar.append(toggleButton, overallField);
  return bar;
}

function renderPageRules(state: ExtensionState): void {
  const entries = Object.entries(state.pageRules);
  pageRules!.innerHTML = "";

  if (entries.length === 0) {
    pageRules!.appendChild(createEmptyState("暂无页面级整体规则。"));
    return;
  }

  entries
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, mode]) => {
      const row = document.createElement("div");
      row.className = "rule-row";

      const title = document.createElement("span");
      title.className = "rule-key";
      title.textContent = key;

      const actions = document.createElement("div");
      actions.className = "rule-actions";
      actions.append(
        createSelect(
          [
            ["same-tab", "同标签页"],
            ["new-tab", "新标签页"],
          ],
          mode,
          (value) => {
            void updatePageRule(key, value as NavigationMode);
          },
        ),
        createGhostButton("删除", () => {
          void removePageRule(key);
        }),
      );

      row.append(title, actions);
      pageRules!.appendChild(row);
    });
}

function renderDebugRecords(records: NavigationDebugRecord[]): void {
  const hostnames = [...new Set(records.map((record) => record.hostname))].sort();
  const selectedHostname = debugFilter?.value ?? "";

  if (debugFilter) {
    debugFilter.innerHTML = "";
    debugFilter.appendChild(createOption("", "全部站点"));
    hostnames.forEach((hostname) => {
      debugFilter.appendChild(createOption(hostname, hostname));
    });
    debugFilter.value = hostnames.includes(selectedHostname) ? selectedHostname : "";
  }

  const visibleRecords = (debugFilter?.value ?? "")
    ? records.filter((record) => record.hostname === debugFilter!.value)
    : records;

  debugRecordsContainer!.innerHTML = "";
  if (visibleRecords.length === 0) {
    debugRecordsContainer!.appendChild(createEmptyState("当前还没有可展示的调试记录。"));
    return;
  }

  visibleRecords.forEach((record) => {
    const definition = getCategoryDefinition(record.category);
    const card = document.createElement("article");
    card.className = "debug-card";
    card.innerHTML = `
      <div class="debug-head">
        <div>
          <strong>${definition.label}</strong>
          <p>${formatTimestamp(record.timestamp)} · ${record.hostname}</p>
        </div>
        <div class="debug-chip-group">
          <span class="status-badge" data-tone="info">${record.trigger}</span>
          <span class="status-badge" data-tone="${toneForDisposition(record.disposition)}">${renderDispositionLabel(record.disposition)}</span>
        </div>
      </div>
      <dl class="debug-grid">
        <div>
          <dt>来源</dt>
          <dd>${renderResolvedByLabel(record.resolvedBy)}</dd>
        </div>
        <div>
          <dt>reason</dt>
          <dd>${record.reason}</dd>
        </div>
        <div>
          <dt>当前页面</dt>
          <dd>${record.pageUrl}</dd>
        </div>
        <div>
          <dt>目标地址</dt>
          <dd>${record.targetUrl}</dd>
        </div>
      </dl>
    `;
    debugRecordsContainer!.appendChild(card);
  });
}

function createActionGroup(
  options: Array<[string, string]>,
  selectedValue: string,
  onSelect: (value: string) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "action-group";
  group.style.setProperty("--plm-option-count", String(options.length));

  options.forEach(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-chip";
    button.textContent = label;
    button.dataset.value = value;
    button.dataset.selected = String(value === selectedValue);
    button.addEventListener("click", () => {
      if (value !== group.dataset.activeValue) {
        syncActionGroupSelection(group, options, value);
        onSelect(value);
      }
    });
    group.appendChild(button);
  });

  syncActionGroupSelection(group, options, selectedValue);
  return group;
}

function createSelect(
  options: Array<[string, string]>,
  selectedValue: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const select = document.createElement("select");
  options.forEach(([value, label]) => {
    select.appendChild(createOption(value, label));
  });
  select.value = selectedValue;
  select.addEventListener("change", () => {
    onChange(select.value);
  });
  return select;
}

function createGhostButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createEmptyState(message: string): HTMLElement {
  const emptyState = document.createElement("p");
  emptyState.className = "empty-state";
  emptyState.textContent = message;
  return emptyState;
}

function createOption(value: string, label: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function syncActionGroupSelection(
  group: HTMLElement,
  options: Array<[string, string]>,
  selectedValue: string,
): void {
  const selectedIndex = Math.max(
    0,
    options.findIndex(([value]) => value === selectedValue),
  );
  group.style.setProperty("--plm-active-index", String(selectedIndex));
  group.dataset.activeValue = selectedValue;
  group.querySelectorAll<HTMLButtonElement>(".action-chip").forEach((button) => {
    button.dataset.selected = String(button.dataset.value === selectedValue);
  });
}

function collectSiteKeys(state: ExtensionState): string[] {
  return [...new Set([
    ...Object.keys(state.siteRules),
    ...Object.keys(state.siteCategoryRules),
    ...state.disabledSites,
  ])].sort();
}

function refreshSiteCardSummary(hostname: string): void {
  if (!currentState) {
    return;
  }

  const details = siteRuleCards?.querySelector<HTMLElement>(`details[data-hostname="${hostname}"]`);
  const summaryText = details?.querySelector<HTMLElement>("[data-role='site-summary-text']");
  const summaryRuleBadge = details?.querySelector<HTMLElement>("[data-role='site-rule-badge']");
  if (!summaryText || !summaryRuleBadge) {
    return;
  }

  const siteRule = currentState.siteRules[hostname] ?? "inherit";
  const explicitCount = Object.keys(currentState.siteCategoryRules[hostname] ?? {}).length;
  summaryText.textContent =
    explicitCount > 0
      ? `已配置 ${explicitCount} 条分类覆写`
      : "当前没有分类覆写，默认继承全局策略。";
  summaryRuleBadge.textContent = renderSiteRuleLabel(siteRule);
}

async function updateGlobalCategoryRule(
  category: NavigationCategory,
  disposition: NavigationDisposition,
): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "plm:set-global-category-rule",
    category,
    disposition,
  } as RuntimeRequest);
  if (currentState) {
    currentState.globalCategoryRules[category] = disposition;
  }
  setStatus("全局分类策略已保存。", "success");
}

async function updateSiteRule(
  hostname: string,
  mode: NavigationMode | "inherit",
): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "plm:set-site-rule",
    hostname,
    mode,
  } as RuntimeRequest);
  await reloadStateOnly("站点整体规则已保存。");
}

async function updateSiteCategoryRule(
  hostname: string,
  category: NavigationCategory,
  rule: SiteCategoryRule,
): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "plm:set-site-category-rule",
    hostname,
    category,
    rule,
  } as RuntimeRequest);
  if (currentState) {
    const nextSiteCategoryRules = {
      ...(currentState.siteCategoryRules[hostname] ?? {}),
    };
    if (rule === "inherit") {
      delete nextSiteCategoryRules[category];
    } else {
      nextSiteCategoryRules[category] = rule;
    }

    if (Object.keys(nextSiteCategoryRules).length === 0) {
      delete currentState.siteCategoryRules[hostname];
    } else {
      currentState.siteCategoryRules[hostname] = nextSiteCategoryRules;
    }
  }
  refreshSiteCardSummary(hostname);
  setStatus("站点分类覆写已保存。", "success");
}

async function toggleSiteEnabled(hostname: string, enabled: boolean): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "plm:set-site-enabled",
    hostname,
    enabled,
  } as RuntimeRequest);
  await reloadStateOnly(enabled ? "当前站点已重新启用。" : "当前站点已停用。");
}

async function updatePageRule(url: string, mode: NavigationMode): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "plm:set-page-rule",
    url,
    mode,
  } as RuntimeRequest);
  await reloadStateOnly("页面整体规则已保存。");
}

async function removePageRule(url: string): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "plm:remove-page-rule",
    url,
  } as RuntimeRequest);
  await reloadStateOnly("页面整体规则已删除。");
}

async function clearDebugRecords(): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "plm:clear-debug-records",
  } as RuntimeRequest);
  currentDebugRecords = [];
  renderDebugRecords([]);
  setStatus("调试记录已清空。", "success");
}

async function reloadStateOnly(message: string): Promise<void> {
  currentState = await getState();
  renderState(currentState);
  setStatus(message, "success");
}

async function exportState(): Promise<void> {
  const state = await getState();
  const blob = new Blob([`${JSON.stringify(state, null, 2)}\n`], {
    type: "application/json",
  });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "pagelinkmode-config.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  setStatus("已导出当前配置。", "success");
}

async function importStateFromFile(): Promise<void> {
  const file = importConfigInput?.files?.[0];
  if (!file) {
    return;
  }

  try {
    const content = await file.text();
    let parsedState: unknown;

    try {
      parsedState = JSON.parse(content);
    } catch {
      setStatus("导入失败：文件不是有效的 JSON。", "error");
      return;
    }

    const response = (await chrome.runtime.sendMessage({
      type: "plm:replace-state",
      state: parsedState as ExtensionState,
    } as RuntimeRequest)) as RuntimeResponse;

    if (isErrorResponse(response)) {
      setStatus(`导入失败：${response.error}`, "error");
      return;
    }

    await loadDashboard();
    setStatus(`已导入 ${file.name}，当前配置已整份替换。`, "success");
  } finally {
    if (importConfigInput) {
      importConfigInput.value = "";
    }
  }
}

async function getState(): Promise<ExtensionState> {
  const response = (await chrome.runtime.sendMessage({
    type: "plm:get-state",
  } as RuntimeRequest)) as RuntimeResponse;

  if (isErrorResponse(response)) {
    throw new Error(response.error);
  }

  return response as ExtensionState;
}

async function getDebugRecords(): Promise<NavigationDebugRecord[]> {
  const response = (await chrome.runtime.sendMessage({
    type: "plm:get-debug-records",
  } as RuntimeRequest)) as RuntimeResponse;

  if (isErrorResponse(response)) {
    throw new Error(response.error);
  }

  return response as NavigationDebugRecord[];
}

function setStatus(message: string, tone: "success" | "error"): void {
  if (!configStatus) {
    return;
  }

  configStatus.hidden = false;
  configStatus.textContent = message;
  configStatus.dataset.tone = tone;
}

function renderSiteRuleLabel(rule: NavigationMode | "inherit"): string {
  if (rule === "inherit") {
    return "继承分类策略";
  }
  return rule === "same-tab" ? "整体强制同标签" : "整体强制新标签";
}

function renderDispositionLabel(disposition: NavigationDisposition): string {
  if (disposition === "same-tab") {
    return "同标签页";
  }
  if (disposition === "new-tab") {
    return "新标签页";
  }
  return "保持原生";
}

function renderResolvedByLabel(resolvedBy: NavigationDebugRecord["resolvedBy"]): string {
  if (resolvedBy === "page") {
    return "页面整体规则";
  }
  if (resolvedBy === "site") {
    return "站点整体规则";
  }
  if (resolvedBy === "site-category") {
    return "站点分类覆写";
  }
  if (resolvedBy === "global-category") {
    return "全局分类策略";
  }
  return "站点已停用";
}

function toneForDisposition(disposition: NavigationDisposition): string {
  if (disposition === "same-tab") {
    return "info";
  }
  if (disposition === "new-tab") {
    return "success";
  }
  return "muted";
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function isErrorResponse(response: RuntimeResponse): response is { ok: false; error: string } {
  return typeof response === "object" && response !== null && "ok" in response && response.ok === false;
}
