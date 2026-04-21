import { updateBadge } from "./badge";
import type { RuntimeRequest, RuntimeResponse } from "../lib/messages";
import { resolveContext, buildUnsupportedPopupContext } from "../lib/rules";
import {
  clearSiteAuthorizationRecords,
  ensureState,
  hasSiteAuthorizationRecord,
  markSiteAuthorized,
  removeSiteAuthorizationRecords,
  replaceState,
  readState,
  writeGlobalMode,
  writePageRule,
  writeSiteEnabled,
  writeSiteRule,
} from "../lib/storage";
import { extractHostnameFromPermissionPattern, isSupportedPageUrl } from "../lib/url";

const pendingContentRecovery = new Map<number, Promise<boolean>>();
let hasBootstrappedRuntime = false;

// 扩展重新启用后，Chrome 不会自动为已经打开的标签页补回 content script。
// 这里在后台恢复运行时主动做一次“已打开页面补注入”，避免用户必须手动刷新页面。
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
  if (changeInfo.status !== "complete") {
    return;
  }

  void ensureContentScriptForTab(tabId, tab.url);
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
    case "plm:replace-state":
      return replaceState(message.state);
    case "plm:open-url":
      await openUrl(message.url, message.mode, sender.tab);
      return { ok: true };
    case "plm:set-global-mode":
      return writeGlobalMode(message.mode);
    case "plm:set-site-enabled":
      return writeSiteEnabled(message.hostname, message.enabled);
    case "plm:set-site-rule":
      return writeSiteRule(message.hostname, message.mode);
    case "plm:set-page-rule":
      return writePageRule(message.url, message.mode);
    case "plm:remove-site-rule":
      return writeSiteRule(message.hostname, "inherit");
    case "plm:remove-page-rule":
      return writePageRule(message.url, "inherit");
    case "plm:set-badge":
      await updateBadge(message.payload);
      return { ok: true };
    default:
      return { ok: true };
  }
}

async function getResolvedContext(url: string) {
  const state = await readState();
  return resolveContext(url, state);
}

async function getPopupContext(url: string) {
  if (!isSupportedPageUrl(url)) {
    return buildUnsupportedPopupContext(url);
  }
  const state = await readState();
  const resolved = resolveContext(url, state);
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
      return false;
    }

    if (await hasReachableContentScript(tabId)) {
      return true;
    }

    try {
      // 只在确认当前页尚未接管时补注入，避免反复叠加脚本监听。
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["js/content.js"],
      });
      return true;
    } catch (error) {
      if (!isIgnorableInjectionError(error)) {
        console.warn("[PageLinkMode] 无法为标签页恢复 content script", {
          tabId,
          url: tabUrl,
          error: getErrorMessage(error),
        });
      }
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
