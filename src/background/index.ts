import { updateBadge } from "./badge";
import type { RuntimeRequest, RuntimeResponse } from "../lib/messages";
import { resolveContext, buildUnsupportedPopupContext } from "../lib/rules";
import { resolveNavigationDecision } from "../lib/navigation";
import {
  appendDebugRecord,
  clearDebugRecords,
  readDebugRecords,
} from "../lib/debug-storage";
import {
  clearSiteAuthorizationRecords,
  ensureState,
  createConfigurationBackup,
  grantRisk,
  hasSiteAuthorizationRecord,
  listRiskGrants,
  markSiteAuthorized,
  removeSiteAuthorizationRecords,
  removePersonalRule,
  replaceState,
  readState,
  readRiskGrant,
  revokeRisk,
  swapPersonalRules,
  upsertPersonalRule,
  writePreset,
  writeGlobalCategoryRule,
  writePageRule,
  writeSiteEnabled,
  writeSiteCategoryRule,
  writeSiteRule,
} from "../lib/storage";
import { extractHostnameFromPermissionPattern, isSupportedPageUrl } from "../lib/url";

const pendingContentRecovery = new Map<number, Promise<boolean>>();
let hasBootstrappedRuntime = false;
let contextBroadcastQueue: Promise<void> = Promise.resolve();
const CONTEXT_STORAGE_KEYS = new Set([
  "schemaVersion",
  "presetId",
  "globalCategoryRules",
  "siteCategoryRules",
  "siteRules",
  "pageRules",
  "personalRules",
  "disabledSites",
  "riskGrants",
]);

export interface ContextBroadcastRuntime {
  queryTabs(): Promise<Array<{ id?: number; url?: string }>>;
  getAllFrames(tabId: number): Promise<Array<{ frameId: number; url: string }> | null>;
  sendContext(tabId: number, frameId: number, context: Awaited<ReturnType<typeof getResolvedContext>>): Promise<void>;
  requestContextRefresh(tabId: number, frameId?: number): Promise<void>;
}

// 扩展重新启用后，Chrome 不会自动为已经打开的标签页补回 content script。
// 这里在后台恢复运行时主动做一次“已打开页面补注入”，避免用户必须手动刷新页面。
if (typeof chrome !== "undefined") {
  void bootstrapRuntime();

  chrome.runtime.onInstalled.addListener(() => {
    void bootstrapRuntime();
  });

  chrome.runtime.onStartup.addListener(() => {
    void bootstrapRuntime();
  });

  chrome.permissions.onRemoved.addListener((permissions) => {
    void handlePermissionsRemoved(permissions);
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void ensureContentScriptForTab(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    void ensureContentScriptForTab(tabId, tab.url);
  });

  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    void refreshFrameContext(details.tabId, details.frameId, details.url);
  });

  chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => {
    void refreshFrameContext(details.tabId, details.frameId, details.url);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (isContextAffectingStorageChange(areaName, changes)) enqueueContextBroadcast();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void handleMessage(message as RuntimeRequest, sender)
      .then(sendResponse)
      .catch((error) => {
        console.error("runtime message failed", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  });
}

export function isContextAffectingStorageChange(
  areaName: string,
  changes: Record<string, unknown>,
): boolean {
  return areaName === "local" && Object.keys(changes).some((key) => CONTEXT_STORAGE_KEYS.has(key));
}

export async function broadcastLatestContexts(
  runtime: ContextBroadcastRuntime = createChromeContextBroadcastRuntime(),
  resolveContextForUrl: (url: string) => Promise<Awaited<ReturnType<typeof getResolvedContext>>> = getResolvedContext,
): Promise<void> {
  const tabs = await runtime.queryTabs();
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id === undefined) return;
    let frames = await runtime.getAllFrames(tab.id);
    if (!frames?.length && tab.url) frames = [{ frameId: 0, url: tab.url }];
    await Promise.allSettled((frames ?? []).map(async (frame) => {
      if (!isSupportedPageUrl(frame.url)) {
        await runtime.requestContextRefresh(tab.id!, frame.frameId);
        return;
      }
      await runtime.sendContext(tab.id!, frame.frameId, await resolveContextForUrl(frame.url));
    }));
  }));
}

function enqueueContextBroadcast(): void {
  contextBroadcastQueue = contextBroadcastQueue
    .then(() => broadcastLatestContexts())
    .catch((error) => {
      console.warn("[PageLinkMode] 无法向已打开页面广播最新规则", getErrorMessage(error));
    });
}

function createChromeContextBroadcastRuntime(): ContextBroadcastRuntime {
  return {
    queryTabs: () => chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }),
    getAllFrames: (tabId) => chrome.webNavigation.getAllFrames({ tabId }),
    sendContext: async (tabId, frameId, context) => {
      await chrome.tabs.sendMessage(tabId, { type: "plm:update-context", context } as RuntimeRequest, { frameId });
    },
    requestContextRefresh: async (tabId, frameId) => {
      await chrome.tabs.sendMessage(tabId, { type: "plm:refresh-context" } as RuntimeRequest, frameId === undefined ? undefined : { frameId });
    },
  };
}

async function bootstrapRuntime(): Promise<void> {
  if (hasBootstrappedRuntime) {
    return;
  }

  hasBootstrappedRuntime = true;
  await ensureState();
  await recoverOpenTabs();
}

async function handleMessage(
  message: RuntimeRequest,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  switch (message.type) {
    case "plm:get-context":
      return getResolvedContext(message.url);
    case "plm:get-popup-context":
      return getPopupContext(message.url);
    case "plm:mark-site-authorized":
      await markSiteAuthorized(message.hostname);
      return { ok: true };
    case "plm:get-state":
      return readState();
    case "plm:get-debug-records":
      return readDebugRecords();
    case "plm:clear-debug-records":
      await clearDebugRecords();
      return { ok: true };
    case "plm:append-debug-record":
      await appendDebugRecord(message.record);
      return { ok: true };
    case "plm:replace-state":
      return replaceState(message.state);
    case "plm:export-backup":
      return createConfigurationBackup(await readState(), chrome.runtime.getManifest().version);
    case "plm:import-backup":
      return replaceState(message.backup);
    case "plm:open-url":
      await openUrl(message.url, message.mode, sender.tab);
      return { ok: true };
    case "plm:apply-preset":
      return writePreset(message.presetId);
    case "plm:set-global-category-rule":
      return writeGlobalCategoryRule(message.category, message.rule);
    case "plm:set-site-enabled":
      return writeSiteEnabled(message.hostname, message.enabled);
    case "plm:set-site-rule":
      return writeSiteRule(message.hostname, message.mode);
    case "plm:set-page-rule":
      return writePageRule(message.url, message.mode);
    case "plm:set-site-category-rule":
      return writeSiteCategoryRule(message.hostname, message.category, message.rule);
    case "plm:remove-site-rule":
      return writeSiteRule(message.hostname, "inherit");
    case "plm:remove-page-rule":
      return writePageRule(message.url, "inherit");
    case "plm:upsert-personal-rule":
      return upsertPersonalRule(message.rule);
    case "plm:remove-personal-rule":
      return removePersonalRule(message.id);
    case "plm:reorder-personal-rules":
      return swapPersonalRules(message.firstId, message.secondId);
    case "plm:get-risk-grants":
      return listRiskGrants();
    case "plm:get-risk-grant":
      return (await readRiskGrant(message.hostname)) ?? null;
    case "plm:grant-risk":
      await grantRisk(message.hostname);
      return listRiskGrants();
    case "plm:revoke-risk":
      await revokeRisk(message.hostname);
      return listRiskGrants();
    case "plm:simulate-navigation": {
      const state = await readState();
      const riskGrant = await readRiskGrant(new URL(message.facts.sourceUrl).hostname);
      return resolveNavigationDecision(message.facts, resolveContext(message.facts.sourceUrl, state, riskGrant));
    }
    case "plm:set-badge":
      await updateBadge({
        ...message.payload,
        tabId: message.payload.tabId ?? sender.tab?.id,
      });
      return { ok: true };
    default:
      return { ok: true };
  }
}

async function getResolvedContext(url: string) {
  const state = await readState();
  const riskGrant = await readRiskGrant(new URL(url).hostname);
  return resolveContext(url, state, riskGrant);
}

async function getPopupContext(url: string) {
  if (!isSupportedPageUrl(url)) {
    return buildUnsupportedPopupContext(url);
  }
  const state = await readState();
  const resolved = resolveContext(url, state, await readRiskGrant(new URL(url).hostname));
  return {
    ...resolved,
    supported: true,
    siteAuthorizationRecorded: await hasSiteAuthorizationRecord(resolved.hostname),
  };
}

async function openUrl(
  url: string,
  mode: "same-tab" | "new-tab",
  sourceTab?: chrome.tabs.Tab,
): Promise<void> {
  if (mode === "same-tab" && sourceTab?.id !== undefined) {
    await chrome.tabs.update(sourceTab.id, { url });
    return;
  }

  const createProperties: chrome.tabs.CreateProperties = {
    url,
    active: true,
  };

  if (sourceTab?.id !== undefined) {
    createProperties.openerTabId = sourceTab.id;
  }
  if (sourceTab?.windowId !== undefined) {
    createProperties.windowId = sourceTab.windowId;
  }
  if (sourceTab?.index !== undefined) {
    createProperties.index = sourceTab.index + 1;
  }

  await chrome.tabs.create(createProperties);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "发生了未知错误。";
}

async function recoverOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({
    url: ["http://*/*", "https://*/*"],
  });

  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined)
      .map((tab) => ensureContentScriptForTab(tab.id!, tab.url)),
  );
}

async function ensureContentScriptForTab(tabId: number, rawUrl?: string): Promise<boolean> {
  const queuedTask = pendingContentRecovery.get(tabId);
  if (queuedTask) {
    return queuedTask;
  }

  const recoveryTask = (async () => {
    const tabUrl = rawUrl ?? (await chrome.tabs.get(tabId)).url;
    if (!tabUrl || !isSupportedPageUrl(tabUrl)) {
      await updateBadge({ tabId, managed: false });
      return false;
    }

    if (await hasReachableContentScript(tabId)) {
      const context = await getResolvedContext(tabUrl);
      await updateBadge({ tabId, managed: context.siteEnabled });
      return true;
    }

    try {
      // 扩展重载后同时恢复主世界桥和所有 frame；各脚本自身保证初始化幂等。
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["js/page-bridge.js"],
        world: "MAIN",
      });
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["js/content.js"],
      });
      const context = await getResolvedContext(tabUrl);
      await updateBadge({ tabId, managed: context.siteEnabled });
      return true;
    } catch (error) {
      if (!isIgnorableInjectionError(error)) {
        console.warn("[PageLinkMode] 无法为标签页恢复 content script", {
          tabId,
          url: tabUrl,
          error: getErrorMessage(error),
        });
      }
      await updateBadge({ tabId, managed: false });
      return false;
    }
  })();

  pendingContentRecovery.set(tabId, recoveryTask);

  try {
    return await recoveryTask;
  } finally {
    pendingContentRecovery.delete(tabId);
  }
}

async function refreshFrameContext(tabId: number, frameId: number, url: string): Promise<void> {
  if (!isSupportedPageUrl(url)) {
    return;
  }

  try {
    const context = await getResolvedContext(url);
    await chrome.tabs.sendMessage(
      tabId,
      { type: "plm:update-context", context } as RuntimeRequest,
      { frameId },
    );
  } catch (error) {
    if (!isIgnorableInjectionError(error)) {
      console.warn("[PageLinkMode] 无法刷新 frame 导航上下文", {
        tabId,
        frameId,
        url,
        error: getErrorMessage(error),
      });
    }
  }
}

async function hasReachableContentScript(tabId: number): Promise<boolean> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "plm:ping-content",
    } as RuntimeRequest)) as RuntimeResponse | undefined;
    return typeof response === "object" && response !== null && "ok" in response && response.ok === true;
  } catch {
    return false;
  }
}

async function handlePermissionsRemoved(permissions: chrome.permissions.Permissions): Promise<void> {
  const removedOrigins = permissions.origins ?? [];
  if (removedOrigins.length === 0) {
    return;
  }

  if (removedOrigins.some((origin) => isWildcardPermissionPattern(origin))) {
    await clearSiteAuthorizationRecords();
    return;
  }

  const hostnames = removedOrigins
    .map((origin) => extractHostnameFromPermissionPattern(origin))
    .filter((hostname): hostname is string => hostname !== null && hostname !== "*");

  if (hostnames.length > 0) {
    await removeSiteAuthorizationRecords(hostnames);
  }
}

function isWildcardPermissionPattern(pattern: string): boolean {
  return (
    pattern === "<all_urls>" ||
    pattern === "*://*/*" ||
    pattern.includes("://*/*") ||
    pattern.includes("://*.")
  );
}

function isIgnorableInjectionError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("cannot access contents of url") ||
    message.includes("the extensions gallery cannot be scripted") ||
    message.includes("receiving end does not exist") ||
    message.includes("no tab with id") ||
    message.includes("tab was closed")
  );
}
