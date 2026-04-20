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

chrome.runtime.onInstalled.addListener(() => {
  void ensureState();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureState();
});

chrome.permissions.onRemoved.addListener((permissions) => {
  void handlePermissionsRemoved(permissions);
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
