import "./styles/base.css";
import "./styles/options.css";

import type { RuntimeRequest, RuntimeResponse } from "./lib/messages";
import type { ExtensionState, NavigationMode } from "./lib/types";

const globalModeSelect = document.querySelector<HTMLSelectElement>("#options-global-mode");
const siteRulesContainer = document.querySelector<HTMLElement>("#site-rules");
const pageRulesContainer = document.querySelector<HTMLElement>("#page-rules");
const siteCount = document.querySelector<HTMLElement>("#site-count");
const pageCount = document.querySelector<HTMLElement>("#page-count");
const exportConfigButton = document.querySelector<HTMLButtonElement>("#export-config");
const importConfigButton = document.querySelector<HTMLButtonElement>("#import-config");
const importConfigInput = document.querySelector<HTMLInputElement>("#import-config-input");
const configStatus = document.querySelector<HTMLElement>("#config-status");

document.addEventListener("DOMContentLoaded", () => {
  void loadState();
  bindEvents();
});

function bindEvents(): void {
  globalModeSelect?.addEventListener("change", () => {
    void chrome.runtime.sendMessage({
      type: "plm:set-global-mode",
      mode: globalModeSelect.value as NavigationMode,
    } as RuntimeRequest);
  });
  exportConfigButton?.addEventListener("click", () => {
    void exportState();
  });
  importConfigButton?.addEventListener("click", () => {
    importConfigInput?.click();
  });
  importConfigInput?.addEventListener("change", () => {
    void importStateFromFile();
  });
}

async function loadState(): Promise<void> {
  const state = await getState();
  renderState(state);
}

function renderState(state: ExtensionState): void {
  globalModeSelect!.value = state.globalMode;
  renderRuleGroup(
    siteRulesContainer!,
    siteCount!,
    Object.entries(state.siteRules),
    "site",
  );
  renderRuleGroup(
    pageRulesContainer!,
    pageCount!,
    Object.entries(state.pageRules),
    "page",
  );
}

function renderRuleGroup(
  container: HTMLElement,
  counter: HTMLElement,
  entries: Array<[string, NavigationMode]>,
  kind: "site" | "page",
): void {
  counter.textContent = `${entries.length} 条`;
  container.innerHTML = "";

  if (entries.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = "暂无规则";
    container.appendChild(emptyState);
    return;
  }

  entries
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, mode]) => {
      container.appendChild(createRuleRow(kind, key, mode));
    });
}

function createRuleRow(
  kind: "site" | "page",
  key: string,
  mode: NavigationMode,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "rule-row";

  const title = document.createElement("span");
  title.className = "rule-key";
  title.textContent = key;

  const select = document.createElement("select");
  select.innerHTML = `
    <option value="same-tab">同标签页</option>
    <option value="new-tab">新标签页</option>
  `;
  select.value = mode;
  select.addEventListener("change", () => {
    void updateRule(kind, key, select.value as NavigationMode);
  });

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "删除";
  removeButton.addEventListener("click", () => {
    void removeRule(kind, key);
  });

  const actions = document.createElement("div");
  actions.className = "rule-actions";
  actions.append(select, removeButton);

  row.append(title, actions);
  return row;
}

async function updateRule(
  kind: "site" | "page",
  key: string,
  mode: NavigationMode,
): Promise<void> {
  const message: RuntimeRequest =
    kind === "site"
      ? { type: "plm:set-site-rule", hostname: key, mode }
      : { type: "plm:set-page-rule", url: key, mode };

  await chrome.runtime.sendMessage(message);
  await loadState();
}

async function removeRule(kind: "site" | "page", key: string): Promise<void> {
  const message: RuntimeRequest =
    kind === "site"
      ? { type: "plm:remove-site-rule", hostname: key }
      : { type: "plm:remove-page-rule", url: key };

  await chrome.runtime.sendMessage(message);
  await loadState();
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

    await loadState();
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

function setStatus(message: string, tone: "success" | "error"): void {
  if (!configStatus) {
    return;
  }

  configStatus.hidden = false;
  configStatus.textContent = message;
  configStatus.dataset.tone = tone;
}

function isErrorResponse(response: RuntimeResponse): response is { ok: false; error: string } {
  return typeof response === "object" && response !== null && "ok" in response && response.ok === false;
}
