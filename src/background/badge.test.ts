import test from "node:test";
import assert from "node:assert/strict";

import { getBadgePresentation } from "./badge";
import { updateBadge } from "./badge";
import {
  broadcastLatestContexts,
  isContextAffectingStorageChange,
  type ContextBroadcastRuntime,
} from "./index";
import type { ResolvedContext } from "../lib/types";

test("徽章只用红绿状态点表达网站是否已托管", () => {
  assert.deepEqual(getBadgePresentation({ managed: true }), {
    text: "",
    path: {
      16: "icons/icon16-managed.png",
      32: "icons/icon32-managed.png",
    },
  });
  assert.deepEqual(getBadgePresentation({ managed: false }), {
    text: "",
    path: {
      16: "icons/icon16-unmanaged.png",
      32: "icons/icon32-unmanaged.png",
    },
  });
});

test("状态图标在构建切换窗口内暂时不可读时不会向后台泄漏 rejection", async () => {
  const calls: string[] = [];
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    action: {
      async setBadgeText() {
        calls.push("setBadgeText");
      },
      async setIcon() {
        calls.push("setIcon");
        throw new Error("Failed to fetch");
      },
    },
  } as unknown as typeof chrome;

  try {
    await assert.doesNotReject(() => updateBadge({ tabId: 7, managed: true }));
    assert.deepEqual(calls, ["setBadgeText", "setIcon"]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("扩展重载导致 action API 上下文失效时图标任务会安静结束", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    action: {
      async setBadgeText() {
        throw new Error("Extension context invalidated.");
      },
      async setIcon() {
        throw new Error("不应继续调用 setIcon");
      },
    },
  } as unknown as typeof chrome;

  try {
    await assert.doesNotReject(() => updateBadge({ tabId: 7, managed: false }));
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("本地配置变化会立即向所有普通网页 frame 广播最新上下文", async () => {
  const updates: Array<{ tabId: number; frameId: number; url: string }> = [];
  const refreshes: Array<{ tabId: number; frameId?: number }> = [];
  const runtime: ContextBroadcastRuntime = {
    queryTabs: async () => [{ id: 7, url: "https://example.com/" }, { id: undefined }],
    getAllFrames: async () => [
      { frameId: 0, url: "https://example.com/" },
      { frameId: 2, url: "https://frame.example.com/" },
      { frameId: 3, url: "about:blank" },
    ],
    sendContext: async (tabId, frameId, context) => {
      updates.push({ tabId, frameId, url: context.url });
    },
    requestContextRefresh: async (tabId, frameId) => {
      refreshes.push({ tabId, frameId });
    },
  };

  await broadcastLatestContexts(runtime, async (url) => ({ url }) as ResolvedContext);

  assert.deepEqual(updates, [
    { tabId: 7, frameId: 0, url: "https://example.com/" },
    { tabId: 7, frameId: 2, url: "https://frame.example.com/" },
  ]);
  assert.deepEqual(refreshes, [{ tabId: 7, frameId: 3 }]);
  assert.equal(isContextAffectingStorageChange("local", { riskGrants: {} }), true);
  assert.equal(isContextAffectingStorageChange("local", { debugRecords: {} }), false);
  assert.equal(isContextAffectingStorageChange("sync", { siteRules: {} }), false);
});
