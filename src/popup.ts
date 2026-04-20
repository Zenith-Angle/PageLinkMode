import "./styles/base.css";
import "./styles/popup.css";

import type { RuntimeRequest, RuntimeResponse } from "./lib/messages";
import type { NavigationMode, PopupContext, RuleMode } from "./lib/types";
import {
  buildPermissionPatternForUrl,
  buildPermissionPatterns,
  isSupportedPageUrl,
} from "./lib/url";

interface PopupUiState {
  isSiteEnabled: boolean;
  isSiteOverrideEnabled: boolean;
  isPageOverrideEnabled: boolean;
  siteSelection: NavigationMode;
  pageSelection: NavigationMode;
}

type PageAccessState = "ready" | "pending" | "unavailable";

const statusCard = document.querySelector<HTMLElement>("#status-card");
const siteEnabledRow = document.querySelector<HTMLElement>("#site-enabled-row");
const siteEnabledToggle = document.querySelector<HTMLButtonElement>("#site-enabled-toggle");
const siteEnabledText = document.querySelector<HTMLElement>("#site-enabled-text");
const statusText = document.querySelector<HTMLParagraphElement>("#status-text");
const hostValue = document.querySelector<HTMLElement>("#host-value");
const pageValue = document.querySelector<HTMLElement>("#page-value");
const effectiveValue = document.querySelector<HTMLElement>("#effective-value");
const sourceValue = document.querySelector<HTMLElement>("#source-value");
const statusChip = document.querySelector<HTMLElement>("#status-chip");
const permissionCard = document.querySelector<HTMLElement>("#permission-card");
const permissionTitle = document.querySelector<HTMLElement>("#permission-title");
const permissionDescription = document.querySelector<HTMLElement>("#permission-description");
const grantAccessButton = document.querySelector<HTMLButtonElement>("#grant-access");
const openOptionsButton = document.querySelector<HTMLButtonElement>("#open-options");
const saveNote = document.querySelector<HTMLElement>("#save-note");
const siteSection = document.querySelector<HTMLElement>("#site-section");
const pageSection = document.querySelector<HTMLElement>("#page-section");
const globalSection = document.querySelector<HTMLElement>("#global-section");
const siteOverrideToggle = document.querySelector<HTMLButtonElement>("#site-override-toggle");
const pageOverrideToggle = document.querySelector<HTMLButtonElement>("#page-override-toggle");
const siteModeGroup = document.querySelector<HTMLElement>("#site-mode-group");
const pageModeGroup = document.querySelector<HTMLElement>("#page-mode-group");
const globalModeGroup = document.querySelector<HTMLElement>("#global-mode-group");
const siteHelperText = document.querySelector<HTMLElement>("#site-helper-text");
const pageHelperText = document.querySelector<HTMLElement>("#page-helper-text");

let activeTabId: number | undefined;
let currentContext: PopupContext | null = null;
let pageAccessState: PageAccessState = "unavailable";
let currentUiState: PopupUiState | null = null;
let lastPermissionRequestSucceeded = false;
let sitePermissionGranted = false;
let saveNoteTimeoutId: number | undefined;

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  void initializePopup();
});

async function initializePopup(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;

  if (!tab?.url || !isSupportedPageUrl(tab.url)) {
    renderUnsupported();
    return;
  }

  currentContext = (await chrome.runtime.sendMessage({
    type: "plm:get-popup-context",
    url: tab.url,
  } as RuntimeRequest)) as PopupContext;
  sitePermissionGranted =
    currentContext.siteAuthorizationRecorded ||
    (await resolvePersistentSitePermissionState(currentContext.url, currentContext.hostname));
  pageAccessState = await resolvePageAccessState(tab.id);

  currentUiState = derivePopupUiState(currentContext);
  renderContext(currentContext, currentUiState);
}

function bindEvents(): void {
  grantAccessButton?.addEventListener("click", () => {
    void handlePermissionAction();
  });
  openOptionsButton?.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });
  siteEnabledToggle?.addEventListener("click", () => {
    void handleSiteEnabledToggle();
  });
  siteOverrideToggle?.addEventListener("click", () => {
    void handleSiteOverrideToggle();
  });
  pageOverrideToggle?.addEventListener("click", () => {
    void handlePageOverrideToggle();
  });

  bindSegmentedGroup(globalModeGroup, (mode) => setGlobalMode(mode));
  bindSegmentedGroup(siteModeGroup, (mode) => setSiteExplicitMode(mode));
  bindSegmentedGroup(pageModeGroup, (mode) => setPageExplicitMode(mode));
}

async function handlePermissionAction(): Promise<void> {
  if (sitePermissionGranted && activeTabId) {
    await reloadTabAndWait(activeTabId);
    await initializePopup();
    return;
  }

  await requestSitePermission();
}

function bindSegmentedGroup(
  group: HTMLElement | null,
  handler: (mode: NavigationMode) => void,
): void {
  group?.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.mode;
      if (mode === "same-tab" || mode === "new-tab") {
        void handler(mode);
      }
    });
  });
}

function derivePopupUiState(context: PopupContext): PopupUiState {
  return {
    isSiteEnabled: context.siteEnabled,
    isSiteOverrideEnabled: context.siteMode !== "inherit",
    isPageOverrideEnabled: context.pageMode !== "inherit",
    siteSelection:
      context.siteMode === "inherit" ? getOppositeMode(context.globalMode) : context.siteMode,
    pageSelection:
      context.pageMode === "inherit"
        ? getOppositeMode(context.effectiveMode)
        : context.pageMode,
  };
}

function renderUnsupported(): void {
  statusCard?.classList.add("is-unsupported");
  statusCard?.setAttribute("data-site-enabled", "true");
  siteEnabledRow!.hidden = true;
  hostValue!.textContent = "当前页面不可用";
  effectiveValue!.textContent = "无法接管";
  sourceValue!.textContent = "来源：浏览器受限页面";
  pageValue!.textContent = "请切换到普通网页后再使用。";
  statusChip!.textContent = "不支持";
  statusChip!.dataset.state = "muted";
  statusText!.textContent = "当前页面不支持接管，例如 chrome:// 页面、扩展页或商店页面。";
  permissionCard!.hidden = true;
  siteSection!.hidden = true;
  pageSection!.hidden = true;
  globalSection!.hidden = true;
}

function renderContext(context: PopupContext, uiState: PopupUiState): void {
  const pageReady = pageAccessState === "ready";
  const canEditRule = sitePermissionGranted && context.siteEnabled;

  siteEnabledRow!.hidden = false;
  siteSection!.hidden = false;
  pageSection!.hidden = false;
  globalSection!.hidden = false;
  statusCard?.classList.remove("is-unsupported");
  statusCard?.setAttribute("data-site-enabled", String(context.siteEnabled));

  updateSwitchState(siteEnabledToggle, uiState.isSiteEnabled, false);
  setHelperText(
    siteEnabledText,
    context.siteEnabled
      ? "开启时由扩展接管当前站点的网页内跳转。"
      : "关闭后回退为浏览器原生导航，重新开启后恢复这里的规则。",
  );
  hostValue!.textContent = context.hostname;
  pageValue!.textContent = context.pageKey;
  effectiveValue!.textContent = context.siteEnabled
    ? context.effectiveMode === "same-tab"
      ? "同标签页"
      : "新标签页"
    : "不干预";
  sourceValue!.textContent = `来源：${renderSourceText(context.effectiveSource)}`;
  statusChip!.textContent = !context.siteEnabled
    ? "已停用"
    : context.effectiveMode === "same-tab"
      ? "当前页"
      : "新标签";
  statusChip!.dataset.state = !context.siteEnabled
    ? "disabled"
    : context.effectiveMode === "same-tab"
      ? "same"
      : "new";

  statusText!.textContent = renderAccessDescription(context, pageAccessState, sitePermissionGranted);
  renderPermissionState(pageAccessState, sitePermissionGranted);

  permissionCard!.hidden = !context.siteEnabled || (sitePermissionGranted && pageReady);

  updateSwitchState(siteOverrideToggle, uiState.isSiteOverrideEnabled, !canEditRule);
  updateSwitchState(pageOverrideToggle, uiState.isPageOverrideEnabled, !canEditRule);
  siteSection!.classList.toggle("is-muted", !context.siteEnabled);
  pageSection!.classList.toggle("is-muted", !context.siteEnabled);

  siteModeGroup!.hidden = !uiState.isSiteOverrideEnabled;
  pageModeGroup!.hidden = !uiState.isPageOverrideEnabled;

  setHelperText(
    siteHelperText,
    !context.siteEnabled
      ? uiState.isSiteOverrideEnabled
        ? `当前站点已停用，重新开启后恢复为${renderModeLabel(uiState.siteSelection)}。`
        : "当前站点已停用，重新开启后才会按这里的规则生效。"
      : uiState.isSiteOverrideEnabled
        ? `当前站点固定为${renderModeLabel(uiState.siteSelection)}。`
        : `关闭时继承全局默认；启用后默认切到${renderModeLabel(uiState.siteSelection)}。`,
  );
  setHelperText(
    pageHelperText,
    !context.siteEnabled
      ? uiState.isPageOverrideEnabled
        ? `当前站点已停用，重新开启后恢复为${renderModeLabel(uiState.pageSelection)}。`
        : "当前站点已停用，重新开启后才会按这里的规则生效。"
      : uiState.isPageOverrideEnabled
        ? `当前页面固定为${renderModeLabel(uiState.pageSelection)}。`
        : `关闭时继承站点或全局规则；启用后默认切到${renderModeLabel(uiState.pageSelection)}。`,
  );

  setSegmentedSelection(globalModeGroup, context.globalMode, false);
  setSegmentedSelection(siteModeGroup, uiState.siteSelection, !canEditRule);
  setSegmentedSelection(pageModeGroup, uiState.pageSelection, !canEditRule);
}

function renderStatusDescription(context: PopupContext): string {
  if (!context.siteEnabled) {
    return "当前站点已停用，扩展不会拦截这个网站的链接、表单或脚本打开行为。";
  }

  if (context.pageMode === "inherit" && context.siteMode === "inherit") {
    return "当前页面正在继承全局默认模式。";
  }

  if (context.pageMode === "inherit" && context.siteMode !== "inherit") {
    return "当前页面正在继承当前站点规则。";
  }

  return "当前页面已启用独立规则，会优先覆盖站点和全局默认。";
}

function renderAccessDescription(
  context: PopupContext,
  accessState: PageAccessState,
  hasSitePermission: boolean,
): string {
  if (!context.siteEnabled) {
    return "当前站点已停用。刷新当前页面后，这个网站会回退为浏览器原生导航，重新开启后会恢复原有规则。";
  }

  if (hasSitePermission && accessState === "ready") {
    return renderStatusDescription(context);
  }

  if (!hasSitePermission && accessState === "ready") {
    return "当前页目前只是临时可访问。若要设置站点级和页面级规则，并让配置在后续访问中持续生效，请先授权当前站点。";
  }

  if (!hasSitePermission) {
    return "当前站点尚未授权。授权后，才能设置站点级和页面级规则，并在后续访问中持续生效。";
  }

  if (accessState === "pending") {
    return "当前站点已经授权。请刷新当前页面后继续，扩展会在刷新后重新接管这里的网页跳转。";
  }

  return "当前站点已经授权，但当前页还没有被扩展接管。请刷新当前页面后再试。";
}

function renderPermissionState(accessState: PageAccessState, hasSitePermission: boolean): void {
  if (!permissionTitle || !permissionDescription || !grantAccessButton) {
    return;
  }

  if (currentContext && !currentContext.siteEnabled) {
    permissionTitle.textContent = "当前站点已停用";
    permissionDescription.textContent = "重新开启后，如需持久规则，再按当前授权状态继续配置。";
    grantAccessButton.textContent = "授权当前站点";
    return;
  }

  if (!hasSitePermission && accessState === "ready") {
    permissionTitle.textContent = "当前站点尚未授权";
    permissionDescription.textContent =
      "当前标签页现在只是临时可访问。若要设置站点级和页面级规则，请先授权当前站点。";
    grantAccessButton.textContent = "授权当前站点";
    return;
  }

  if (!hasSitePermission) {
    permissionTitle.textContent = "当前站点未授权";
    permissionDescription.textContent =
      "授权后，才能设置站点级和页面级规则，并在后续访问中持续生效。";
    grantAccessButton.textContent = "授权当前站点";
    return;
  }

  if (accessState !== "ready") {
    permissionTitle.textContent = "当前站点已授权";
    permissionDescription.textContent =
      "站点授权已经完成，但当前页还没有被扩展重新接管。请刷新当前页面后继续。";
    grantAccessButton.textContent = "刷新当前页面";
    return;
  }

  permissionTitle.textContent = "当前站点已授权";
  permissionDescription.textContent = "当前页面已经可以被扩展稳定接管。";
  grantAccessButton.textContent = "授权当前站点";
}

function renderSourceText(source: PopupContext["effectiveSource"]): string {
  if (source === "disabled") {
    return "站点已停用";
  }
  if (source === "page") {
    return "页面规则";
  }
  if (source === "site") {
    return "站点规则";
  }
  return "全局默认";
}

function renderModeLabel(mode: NavigationMode): string {
  return mode === "same-tab" ? "同标签页" : "新标签页";
}

function updateSwitchState(
  button: HTMLButtonElement | null,
  pressed: boolean,
  disabled: boolean,
): void {
  if (!button) {
    return;
  }

  button.setAttribute("aria-pressed", String(pressed));
  button.classList.toggle("is-on", pressed);
  button.disabled = disabled;
}

function setHelperText(target: HTMLElement | null, text: string): void {
  if (target) {
    target.textContent = text;
  }
}

function setSegmentedSelection(
  group: HTMLElement | null,
  value: NavigationMode,
  disabled: boolean,
): void {
  group?.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((button) => {
    const selected = button.dataset.mode === value;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = disabled;
  });

  if (group) {
    group.classList.toggle("is-disabled", disabled);
  }
}

async function requestSitePermission(): Promise<void> {
  if (!currentContext) {
    return;
  }

  lastPermissionRequestSucceeded = await chrome.permissions.request({
    origins: buildPermissionPatterns(currentContext.hostname),
  });

  if (lastPermissionRequestSucceeded) {
    await chrome.runtime.sendMessage({
      type: "plm:mark-site-authorized",
      hostname: currentContext.hostname,
    } as RuntimeRequest);
    showSaveNote("站点已授权，刷新当前页面后生效。");
  } else {
    showSaveNote("未完成授权，站点级和页面级规则仍不可用。");
  }

  await initializePopup();
}

async function handleSiteEnabledToggle(): Promise<void> {
  if (!currentContext) {
    return;
  }

  await setSiteEnabled(!currentContext.siteEnabled);
}

async function handleSiteOverrideToggle(): Promise<void> {
  if (!currentContext || !currentUiState || !sitePermissionGranted) {
    return;
  }

  await toggleSiteOverride(!currentUiState.isSiteOverrideEnabled);
}

async function handlePageOverrideToggle(): Promise<void> {
  if (!currentContext || !currentUiState || !sitePermissionGranted) {
    return;
  }

  await togglePageOverride(!currentUiState.isPageOverrideEnabled);
}

async function setSiteEnabled(enabled: boolean): Promise<void> {
  if (!currentContext) {
    return;
  }

  await chrome.runtime.sendMessage({
    type: "plm:set-site-enabled",
    hostname: currentContext.hostname,
    enabled,
  } as RuntimeRequest);
  await refreshPopup({ reloadTab: false });
  showSaveNote(
    enabled
      ? "当前站点已重新启用，刷新当前页面后恢复生效。"
      : "当前站点已停用，刷新当前页面后停止生效。",
  );
}

async function toggleSiteOverride(enabled: boolean): Promise<void> {
  if (!currentContext || !currentUiState) {
    return;
  }

  const mode = enabled ? currentUiState.siteSelection : "inherit";
  await sendRuleUpdate("plm:set-site-rule", currentContext.hostname, mode);
  await refreshPopup({ reloadTab: false });
  showSaveNote("站点规则已保存，刷新当前页面后生效。");
}

async function togglePageOverride(enabled: boolean): Promise<void> {
  if (!currentContext || !currentUiState) {
    return;
  }

  const mode = enabled ? currentUiState.pageSelection : "inherit";
  await sendRuleUpdate("plm:set-page-rule", currentContext.pageKey, mode);
  await refreshPopup({ reloadTab: false });
  showSaveNote("页面规则已保存，刷新当前页面后生效。");
}

async function setSiteExplicitMode(mode: NavigationMode): Promise<void> {
  if (!currentContext || !sitePermissionGranted) {
    return;
  }

  await sendRuleUpdate("plm:set-site-rule", currentContext.hostname, mode);
  await refreshPopup({ reloadTab: false });
  showSaveNote("站点规则已保存，刷新当前页面后生效。");
}

async function setPageExplicitMode(mode: NavigationMode): Promise<void> {
  if (!currentContext || !sitePermissionGranted) {
    return;
  }

  await sendRuleUpdate("plm:set-page-rule", currentContext.pageKey, mode);
  await refreshPopup({ reloadTab: false });
  showSaveNote("页面规则已保存，刷新当前页面后生效。");
}

async function setGlobalMode(mode: NavigationMode): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "plm:set-global-mode",
    mode,
  } as RuntimeRequest);
  await refreshPopup({ reloadTab: false });
  showSaveNote("默认跳转方式已保存，刷新当前页面后生效。");
}

async function sendRuleUpdate(
  type: "plm:set-site-rule" | "plm:set-page-rule",
  value: string,
  mode: RuleMode,
): Promise<void> {
  if (type === "plm:set-site-rule") {
    await chrome.runtime.sendMessage({
      type,
      hostname: value,
      mode,
    } as RuntimeRequest);
    return;
  }

  await chrome.runtime.sendMessage({
    type,
    url: value,
    mode,
  } as RuntimeRequest);
}

async function refreshPopup(options?: { reloadTab?: boolean }): Promise<void> {
  if (options?.reloadTab !== false && pageAccessState === "ready" && activeTabId) {
    await reloadTabAndWait(activeTabId);
  }
  await initializePopup();
}

function getOppositeMode(mode: NavigationMode): NavigationMode {
  return mode === "same-tab" ? "new-tab" : "same-tab";
}

async function resolvePageAccessState(tabId?: number): Promise<PageAccessState> {
  if (tabId === undefined) {
    return lastPermissionRequestSucceeded ? "pending" : "unavailable";
  }

  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "plm:ping-content",
    } as RuntimeRequest)) as RuntimeResponse | undefined;

    if (isOkResponse(response)) {
      lastPermissionRequestSucceeded = false;
      return "ready";
    }
  } catch {
    // 当前页面没有可通信的 content script，视为尚未完成接管。
  }

  return lastPermissionRequestSucceeded ? "pending" : "unavailable";
}

async function resolvePersistentSitePermissionState(rawUrl: string, hostname: string): Promise<boolean> {
  if (!rawUrl || !hostname) {
    return false;
  }

  try {
    const hasFullSitePermission = await chrome.permissions.contains({
      origins: buildPermissionPatterns(hostname),
    });
    if (hasFullSitePermission) {
      return true;
    }

    return await chrome.permissions.contains({
      origins: [buildPermissionPatternForUrl(rawUrl)],
    });
  } catch {
    return false;
  }
}

async function reloadTabAndWait(tabId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let finished = false;
    const timeoutId = window.setTimeout(finish, 3000);

    const handleUpdated = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish();
      }
    };

    function finish(): void {
      if (finished) {
        return;
      }

      finished = true;
      window.clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(handleUpdated);
    void chrome.tabs.reload(tabId).catch(() => {
      finish();
    });
  });
}

function isOkResponse(response: RuntimeResponse | undefined): response is { ok: true } {
  return typeof response === "object" && response !== null && "ok" in response && response.ok === true;
}

function showSaveNote(message: string): void {
  if (!saveNote) {
    return;
  }

  saveNote.hidden = false;
  saveNote.textContent = message;

  if (saveNoteTimeoutId !== undefined) {
    window.clearTimeout(saveNoteTimeoutId);
  }

  saveNoteTimeoutId = window.setTimeout(() => {
    saveNote.hidden = true;
  }, 2400);
}
