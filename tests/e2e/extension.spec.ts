import { chromium, type BrowserContext, type CDPSession, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { test, expect } from "./extension.fixture";

const FIXTURE = "http://127.0.0.1:4173";

type DebugRecord = {
  targetUrl: string;
  trigger: string;
  category: string;
  applied: boolean;
  bypassReason?: string;
  resolvedBy: string;
  winningRuleId?: string;
};

type StoredRule = {
  id: string;
  enabled: boolean;
  sensitiveEnabled: boolean;
};

type ElementBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual(expect.objectContaining({
    clientWidth: page.viewportSize()!.width,
    scrollWidth: page.viewportSize()!.width,
  }));
}

async function visibleBoxes(locator: Locator): Promise<ElementBox[]> {
  return locator.evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return [];
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return [];
    return [{ x: box.x, y: box.y, width: box.width, height: box.height }];
  }));
}

function boxesOverlap(first: ElementBox, second: ElementBox, tolerance = 0.5): boolean {
  return first.x + first.width > second.x + tolerance &&
    second.x + second.width > first.x + tolerance &&
    first.y + first.height > second.y + tolerance &&
    second.y + second.height > first.y + tolerance;
}

async function expectNoPairwiseOverlap(locator: Locator): Promise<void> {
  const boxes = await visibleBoxes(locator);
  for (let firstIndex = 0; firstIndex < boxes.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < boxes.length; secondIndex += 1) {
      expect(boxesOverlap(boxes[firstIndex], boxes[secondIndex]),
        `元素 ${firstIndex + 1} 与元素 ${secondIndex + 1} 的矩形发生重叠`).toBe(false);
    }
  }
}

async function expectTextFits(locator: Locator): Promise<void> {
  const overflow = await locator.evaluateAll((elements) => elements.flatMap((element, index) => {
    const htmlElement = element as HTMLElement;
    if (getComputedStyle(htmlElement).display === "none" || htmlElement.getClientRects().length === 0) return [];
    const horizontallyClipped = htmlElement.scrollWidth > htmlElement.clientWidth + 1;
    const verticallyClipped = htmlElement.scrollHeight > htmlElement.clientHeight + 1;
    return horizontallyClipped || verticallyClipped
      ? [{ index, text: htmlElement.textContent?.trim() ?? "", clientWidth: htmlElement.clientWidth,
        scrollWidth: htmlElement.scrollWidth, clientHeight: htmlElement.clientHeight,
        scrollHeight: htmlElement.scrollHeight }]
      : [];
  }));
  expect(overflow, `文本超出控件边界：${JSON.stringify(overflow)}`).toEqual([]);
}

async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 0.5);
}

async function expectVisibleKeyboardFocus(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  const focusStyle = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focusVisible: element.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      boxShadow: style.boxShadow,
    };
  });
  expect(focusStyle.focusVisible).toBe(true);
  expect(focusStyle.outlineStyle !== "none" && focusStyle.outlineWidth >= 1 || focusStyle.boxShadow !== "none").toBe(true);
}

async function send<T>(control: Page, message: Record<string, unknown>): Promise<T> {
  return control.evaluate(async (request) => chrome.runtime.sendMessage(request), message) as Promise<T>;
}

async function clearDebugRecords(control: Page): Promise<void> {
  await send(control, { type: "plm:clear-debug-records" });
}

async function getDebugRecords(control: Page): Promise<DebugRecord[]> {
  return send(control, { type: "plm:get-debug-records" });
}

async function waitForDebugRecord(
  control: Page,
  predicate: (record: DebugRecord) => boolean,
): Promise<DebugRecord> {
  let matched: DebugRecord | undefined;
  await expect.poll(async () => {
    matched = (await getDebugRecords(control)).find(predicate);
    return Boolean(matched);
  }).toBe(true);
  return matched!;
}

async function waitForContentReady(control: Page, url: string): Promise<void> {
  await expect.poll(() => control.evaluate(async (pageUrl) => {
    const [tab] = await chrome.tabs.query({ url: pageUrl });
    if (tab?.id === undefined) return false;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "plm:ping-content" });
      return response?.ok === true;
    } catch {
      return false;
    }
  }, url)).toBe(true);
}

async function openPageFrom(
  context: BrowserContext,
  action: () => Promise<void>,
): Promise<Page> {
  const opened = context.waitForEvent("page");
  await action();
  const page = await opened;
  await page.waitForLoadState();
  return page;
}

async function getExtensionId(context: BrowserContext): Promise<string> {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  return new URL(worker.url()).hostname;
}

type PopupDimensions = {
  viewportWidth: number;
  viewportHeight: number;
  outerWidth: number;
  outerHeight: number;
  documentWidth: number;
  documentHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  bodyWidth: number;
  shellHeight: number;
};

type ActionPopupTarget = {
  evaluate<T>(expression: string): Promise<T>;
  close(): Promise<void>;
};

async function openActionPopup(
  context: BrowserContext,
  control: Page,
  extensionId: string,
): Promise<ActionPopupTarget> {
  const popupUrl = `chrome-extension://${extensionId}/src/popup.html`;
  const browser = context.browser();
  if (!browser) throw new Error("持久化浏览器上下文缺少 Browser 实例");
  const rootSession = await browser.newBrowserCDPSession();
  let targetId: string | undefined;
  let sessionId: string | undefined;

  try {
    const before = await rootSession.send("Target.getTargets");
    const existingTargets = new Set(before.targetInfos.map((target) => target.targetId));
    await control.evaluate(async () => chrome.action.openPopup());

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !targetId) {
      const { targetInfos } = await rootSession.send("Target.getTargets");
      targetId = targetInfos.find((target) =>
        target.url.startsWith(popupUrl) && !existingTargets.has(target.targetId),
      )?.targetId;
      if (!targetId) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!targetId) throw new Error("chrome.action.openPopup() 后未发现真实 Popup target");

    ({ sessionId } = await rootSession.send("Target.attachToTarget", { targetId, flatten: false }));
    const command = createNestedCdpCommand(rootSession, sessionId);
    await command("Runtime.enable");

    return {
      async evaluate<T>(expression: string): Promise<T> {
        const response = await command("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        }) as {
          result: { value: T };
          exceptionDetails?: { text: string; exception?: { description?: string } };
        };
        if (response.exceptionDetails) {
          throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
        }
        return response.result.value;
      },
      async close(): Promise<void> {
        try {
          await rootSession.send("Target.closeTarget", { targetId: targetId! });
        } finally {
          await rootSession.detach();
        }
      },
    };
  } catch (error) {
    if (targetId) await rootSession.send("Target.closeTarget", { targetId }).catch(() => undefined);
    await rootSession.detach().catch(() => undefined);
    throw error;
  }
}

function createNestedCdpCommand(rootSession: CDPSession, sessionId: string) {
  let commandId = 0;
  return async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const id = ++commandId;
    const response = new Promise<unknown>((resolve, reject) => {
      const onMessage = (event: { sessionId: string; message: string }) => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message) as {
          id?: number;
          result?: unknown;
          error?: { message: string };
        };
        if (message.id !== id) return;
        rootSession.off("Target.receivedMessageFromTarget", onMessage);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      };
      rootSession.on("Target.receivedMessageFromTarget", onMessage);
    });
    await rootSession.send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({ id, method, params }),
    });
    return response;
  };
}

async function readPopupDimensions(popup: ActionPopupTarget): Promise<PopupDimensions> {
  return popup.evaluate(`(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    documentWidth: document.documentElement.clientWidth,
    documentHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    bodyWidth: document.body.getBoundingClientRect().width,
    shellHeight: document.querySelector(".popup-shell").getBoundingClientRect().height,
  }))()`);
}

async function expectStableActionPopupLayout(popup: ActionPopupTarget): Promise<PopupDimensions> {
  await expect.poll(() => readPopupDimensions(popup)).toEqual(expect.objectContaining({
    bodyWidth: 360,
  }));

  const samples: PopupDimensions[] = [];
  for (let index = 0; index < 8; index += 1) {
    await popup.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve(true)))");
    samples.push(await readPopupDimensions(popup));
  }
  expect(samples[0].documentWidth).toBeGreaterThanOrEqual(360);
  expect(samples[0].scrollWidth).toBe(samples[0].documentWidth);
  expect(samples).toEqual(Array(8).fill(samples[0]));
  return samples[0];
}

async function applyWidestPreset(options: Page): Promise<void> {
  const range = options.locator("#basic-preset-range");
  await range.focus();
  await range.press("End");
  await expect(options.getByRole("dialog", { name: "应用基础预设" })).toBeVisible();
  await options.getByRole("dialog").getByRole("button", { name: "应用" }).click();
  await expect(options.locator("#active-preset")).toHaveText("当前：最广");
}

test("Options 在桌面与窄屏保持紧凑比例且支持键盘操作", async ({ page, extensionId }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);
  await expect(page.locator(".category-row")).toHaveCount(29);

  const layout = await page.locator(".options-layout").boundingBox();
  const sidebar = await page.locator(".workspace-sidebar").boundingBox();
  expect(layout).not.toBeNull();
  expect(sidebar).not.toBeNull();
  expect(layout!.width).toBeLessThanOrEqual(1280);
  expect(sidebar!.width).toBeGreaterThanOrEqual(200);
  expect(sidebar!.width).toBeLessThanOrEqual(216);
  await expectNoHorizontalOverflow(page);
  await expectNoPairwiseOverlap(page.locator(".workspace-tabs button"));
  await expectNoPairwiseOverlap(page.locator(".category-row:visible .action-group button"));
  await expectTextFits(page.locator(".workspace-tabs button, .category-row:visible .action-group button"));
  await page.screenshot({ path: testInfo.outputPath("options-1280x800.png"), fullPage: true });

  const basicTab = page.locator('[data-workspace-tab="basic"]');
  const sitesTab = page.locator('[data-workspace-tab="sites"]');
  await basicTab.focus();
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(sitesTab);
  await page.keyboard.press("Enter");
  await expect(sitesTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(basicTab).toHaveAttribute("aria-selected", "true");

  const presetRange = page.locator("#basic-preset-range");
  await page.locator('[data-workspace-tab="backup"]').focus();
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(presetRange);
  await presetRange.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "应用基础预设" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();

  for (const viewport of [
    { width: 420, height: 820, screenshot: "options-420x820.png" },
    { width: 320, height: 700, screenshot: "options-320x700.png" },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expectNoHorizontalOverflow(page);
    await expectNoPairwiseOverlap(page.locator(".workspace-tabs button"));
    await expectTextFits(page.locator(".workspace-tabs button, .category-row:visible .action-group button"));
    await page.screenshot({ path: testInfo.outputPath(viewport.screenshot), fullPage: true });
  }

  const fourActionGroup = page.locator(".category-row:visible .action-group:has(button:nth-child(4))").first();
  await expect(fourActionGroup).toBeVisible();
  const actionBoxes = await visibleBoxes(fourActionGroup.locator("button"));
  const columnCount = new Set(actionBoxes.map((box) => Math.round(box.x))).size;
  const rowCount = new Set(actionBoxes.map((box) => Math.round(box.y))).size;
  expect(actionBoxes).toHaveLength(4);
  expect(columnCount).toBeLessThanOrEqual(2);
  expect(rowCount).toBeLessThanOrEqual(2);
  await expectNoPairwiseOverlap(fourActionGroup.locator("button"));
});

test("个性化规则编辑器关闭时列表满宽，打开后才形成双栏", async ({ page, extensionId }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/src/options.html?view=personal`);

  const workspace = page.locator(".split-workspace");
  const list = page.locator("#personal-rule-list");
  await expect(workspace).toHaveAttribute("data-editor-open", "false");
  const closedWorkspaceBox = await workspace.boundingBox();
  const closedListBox = await list.boundingBox();
  expect(closedWorkspaceBox).not.toBeNull();
  expect(closedListBox).not.toBeNull();
  expect(Math.abs(closedWorkspaceBox!.width - closedListBox!.width)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "新建规则" }).click();
  await expect(workspace).toHaveAttribute("data-editor-open", "true");
  const editor = page.locator("#personal-rule-editor");
  await expect(editor).toBeVisible();
  const openListBox = await list.boundingBox();
  const editorBox = await editor.boundingBox();
  expect(openListBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(boxesOverlap(openListBox!, editorBox!)).toBe(false);
  expect(openListBox!.x + openListBox!.width).toBeLessThanOrEqual(editorBox!.x + 0.5);
  expect(openListBox!.width).toBeLessThan(closedListBox!.width);
  await expectNoHorizontalOverflow(page);

  await page.locator("#close-personal-editor").click();
  await expect(workspace).toHaveAttribute("data-editor-open", "false");
  await expect(editor).toBeHidden();
  const restoredListBox = await list.boundingBox();
  expect(restoredListBox!.width).toBeCloseTo(closedListBox!.width, 0);
});

test("高风险警告弹窗在桌面与窄屏无重叠", async ({ page, extensionId }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/src/options.html?view=personal&scope=site&hostname=127.0.0.1`);
  await page.getByRole("button", { name: "解锁" }).click();
  const dialog = page.getByRole("dialog", { name: "解锁高风险规则" });
  const dialogSections = page.locator("#risk-confirm-form > .modal-head, #risk-confirm-form > ul, #risk-confirm-form > .check-row, #risk-confirm-form > .modal-field, #risk-confirm-form > .modal-actions");
  await expect(dialog).toBeVisible();
  await expectInsideViewport(page, dialog);
  await expectNoPairwiseOverlap(dialogSections);
  await expectTextFits(dialog.getByRole("button"));
  await page.screenshot({ path: testInfo.outputPath("risk-dialog-1280x800.png") });

  await page.setViewportSize({ width: 320, height: 700 });
  await expectInsideViewport(page, dialog);
  await expectNoHorizontalOverflow(page);
  await expectNoPairwiseOverlap(dialogSections);
  await expectTextFits(dialog.getByRole("button"));
  await page.screenshot({ path: testInfo.outputPath("risk-dialog-320x700.png") });
});

test("Popup 固定 360px 根宽度且内容高度自适应", async ({ context, extensionId }, testInfo) => {
  const source = await context.newPage();
  await source.goto(`${FIXTURE}/e2e-navigation.html`);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 700 });
  await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
  await expect(popup.locator("#status-label")).not.toHaveText("正在读取");

  const assertPopupLayout = async (screenshot: string): Promise<void> => {
    await popup.setViewportSize({ width: 360, height: 700 });
    const contentHeight = await popup.locator(".popup-shell").evaluate((element) => Math.ceil(element.getBoundingClientRect().height));
    expect(contentHeight).toBeLessThan(700);
    expect(contentHeight).toBeGreaterThan(280);
    await popup.setViewportSize({ width: 360, height: contentHeight });
    await expectNoHorizontalOverflow(popup);
    await expectNoPairwiseOverlap(popup.locator(".personal-entry-actions button"));
    await expectNoPairwiseOverlap(popup.locator(".action-group:visible button"));
    await expectTextFits(popup.locator("button:visible, .action-group:visible button"));
    const dimensions = await popup.evaluate(() => {
      const main = document.querySelector<HTMLElement>(".popup-shell")!;
      const visibleChildren = [...main.children].filter((element) => element.getClientRects().length > 0);
      const lastChild = visibleChildren.at(-1)!.getBoundingClientRect();
      const mainBox = main.getBoundingClientRect();
      return {
        bodyMinHeight: getComputedStyle(document.body).minHeight,
        bodyWidth: document.body.getBoundingClientRect().width,
        trailingSpace: mainBox.bottom - lastChild.bottom,
      };
    });
    expect(dimensions.bodyMinHeight).not.toBe("500px");
    expect(dimensions.bodyWidth).toBeCloseTo(360, 0);
    expect(dimensions.trailingSpace).toBeLessThanOrEqual(16);
    await popup.screenshot({ path: testInfo.outputPath(screenshot), fullPage: true });
  };

  await assertPopupLayout("popup-360-auto.png");
  await popup.setViewportSize({ width: 360, height: 600 });
  const maxPopupDimensions = await popup.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(maxPopupDimensions).toEqual({ clientHeight: 600, scrollHeight: 600 });

  // 复现 Chrome action popup 首帧可能只分配 301px 宿主宽度的自动定宽中间态。
  await popup.setViewportSize({ width: 301, height: 700 });
  const constrainedDimensions = await popup.evaluate(() => ({
    bodyWidth: document.body.getBoundingClientRect().width,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(constrainedDimensions).toEqual({ bodyWidth: 360, scrollWidth: 360 });
});

test("真实工具栏 Popup 在滑块和规则交互后始终保持相同布局", async ({ context, extensionId }) => {
  const sourceUrl = `${FIXTURE}/e2e-navigation.html`;
  const source = await context.newPage();
  await source.goto(sourceUrl);

  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  await control.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (tab?.id === undefined) throw new Error("未找到待验证的活动网页标签");
    await chrome.tabs.update(tab.id, { active: true });
  }, sourceUrl);
  await source.reload();

  const popup = await openActionPopup(context, control, extensionId);
  try {
    await expect.poll(() => popup.evaluate<string>(
      "document.querySelector('#status-label')?.textContent ?? ''",
    )).not.toBe("正在读取");
    await popup.evaluate(`(() => {
      document.querySelector("#site-rule-actions").setAttribute("data-test-node-identity", "site-actions");
      document.querySelector("#page-rule-actions").setAttribute("data-test-node-identity", "page-actions");
      return true;
    })()`);
    const initialDimensions = await expectStableActionPopupLayout(popup);

    await popup.evaluate(`(() => {
      const range = document.querySelector("#popup-preset-range");
      if (!(range instanceof HTMLInputElement)) throw new Error("未找到快速预设滑块");
      range.value = "4";
      range.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await expect.poll(() => popup.evaluate<string>(
      "document.querySelector('#popup-preset-label')?.textContent ?? ''",
    )).toBe("当前：最广");
    await expect.poll(async () => (await send<{ presetId: string }>(control, { type: "plm:get-state" })).presetId).toBe("widest");
    expect(await expectStableActionPopupLayout(popup)).toEqual(initialDimensions);

    await popup.evaluate(`(() => {
      const button = document.querySelector("#site-rule-actions button[data-value='same-tab']");
      if (!(button instanceof HTMLButtonElement)) throw new Error("未找到站点规则交互按钮");
      button.click();
      return true;
    })()`);
    await expect.poll(() => popup.evaluate<string>(
      "document.querySelector('#popup-status')?.textContent ?? ''",
    )).toBe("规则已保存。");
    expect(await expectStableActionPopupLayout(popup)).toEqual(initialDimensions);

    await popup.evaluate(`(() => {
      const button = document.querySelector("#page-rule-actions button[data-value='new-tab']");
      if (!(button instanceof HTMLButtonElement)) throw new Error("未找到页面规则交互按钮");
      button.click();
      return true;
    })()`);
    await expect.poll(() => popup.evaluate<boolean>(
      "document.querySelector(\"#page-rule-actions button[data-value='new-tab']\")?.getAttribute('data-selected') === 'true'",
    )).toBe(true);
    expect(await expectStableActionPopupLayout(popup)).toEqual(initialDimensions);

    await popup.evaluate(`(() => {
      const button = document.querySelector("#site-enabled");
      if (!(button instanceof HTMLButtonElement)) throw new Error("未找到站点开关");
      button.click();
      return true;
    })()`);
    await expect.poll(() => popup.evaluate<string | null>(
      "document.querySelector('#site-enabled')?.getAttribute('aria-checked') ?? null",
    )).toBe("false");
    expect(await expectStableActionPopupLayout(popup)).toEqual(initialDimensions);

    expect(await popup.evaluate(`(() => ({
      statusPosition: getComputedStyle(document.querySelector("#popup-status")).position,
      statusParent: document.querySelector("#popup-status")?.parentElement?.id,
      reusedActionGroups:
        document.querySelector("#site-rule-actions")?.getAttribute("data-test-node-identity") === "site-actions" &&
        document.querySelector("#page-rule-actions")?.getAttribute("data-test-node-identity") === "page-actions",
    }))()`)).toEqual({ statusPosition: "absolute", statusParent: "status-band", reusedActionGroups: true });
  } finally {
    await popup.close();
  }
});

test("Options 提供完整基础分类、预设和个性化规则工作流", async ({ page, extensionId }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);
  await expect(page.getByRole("heading", { name: "规则工作台" })).toBeVisible();
  await expect(page.locator(".category-row")).toHaveCount(29);
  await expect(page.getByText("始终保持原生", { exact: true })).toBeVisible();

  const presetRange = page.locator("#basic-preset-range");
  await applyWidestPreset(page);

  await send(page, {
    type: "plm:set-global-category-rule",
    category: "link-same-origin",
    rule: "preserve-native",
  });
  await page.reload();
  await expect(page.locator("#active-preset")).toHaveText("当前：自定义");
  await expect(page.locator("#preset-selection-label")).toHaveText("待选：适中");
  await expect(presetRange).toHaveValue("2");

  await page.getByRole("button", { name: "站点覆写" }).click();
  await page.locator("#add-site-hostname").fill("127.0.0.1");
  await page.getByRole("button", { name: "添加站点" }).click();
  await expect(page.getByText("127.0.0.1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "个性化规则" }).click();
  await page.getByRole("button", { name: "新建规则" }).click();
  await expect(page.locator("#personal-rule-editor")).toBeVisible();
  await page.locator("#personal-name").fill("目标页保持原生");
  await page.locator("#personal-hostname").fill("127.0.0.1");
  await page.locator("#personal-target-kind").selectOption("exact");
  await page.locator("#personal-target-value").fill(`${FIXTURE}/destination.html`);
  await page.getByRole("button", { name: "保存规则" }).click();
  await expect(page.getByText("目标页保持原生", { exact: true })).toBeVisible();
  await page.locator(".personal-rule-item").filter({ hasText: "目标页保持原生" }).click();

  await expect(page.locator("#risk-hostname")).toHaveValue("127.0.0.1");
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.getByRole("button", { name: "解锁" }).click();
  await page.locator("#risk-acknowledge").check();
  await page.locator("#risk-confirm-hostname").fill("127.0.0.1");
  await page.screenshot({ path: testInfo.outputPath("risk-warning-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 420, height: 820 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("risk-warning-narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.getByRole("dialog").getByRole("button", { name: "解锁站点" }).click();
  await expect(page.locator("#risk-state")).toHaveText("本机已解锁");

  await page.screenshot({ path: testInfo.outputPath("options-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 420, height: 820 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("options-narrow.png"), fullPage: true });
  expect(consoleErrors).toEqual([]);
});

test("Options 页面整体规则可编辑且风险授权只跟随明确上下文", async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/src/options.html?view=pages`);

  const pageRuleUrl = page.locator("#page-rule-url");
  await pageRuleUrl.fill("https://Example.COM/article?id=1#section");
  await page.locator("#page-rule-mode").selectOption("new-tab");
  await page.getByRole("button", { name: "保存页面规则" }).click();
  await expect(page.locator("#config-status")).toHaveText("页面整体规则已保存。");
  await expect(page.locator(".page-rule-item")).toContainText("https://example.com/article?id=1");

  await page.locator(".page-rule-item").click();
  await expect(pageRuleUrl).toHaveValue("https://example.com/article?id=1");
  await expect(page.locator("#page-rule-mode")).toHaveValue("new-tab");
  await page.locator("#page-rule-mode").selectOption("preserve-native");
  await page.getByRole("button", { name: "保存页面规则" }).click();
  await expect(page.locator(".page-rule-item")).toContainText("保持原生");

  await page.locator(".page-rule-item").click();
  await page.locator("#page-rule-mode").selectOption("same-tab");
  await page.getByRole("button", { name: "保存页面规则" }).click();
  await expect(page.locator(".page-rule-item")).toContainText("同标签");

  await pageRuleUrl.fill("ftp://example.com/file");
  await page.getByRole("button", { name: "保存页面规则" }).click();
  await expect(page.locator("#config-status")).toContainText("仅支持 http/https");
  await expect(pageRuleUrl).toHaveValue("ftp://example.com/file");

  await page.locator(".page-rule-item").getByRole("button", { name: "删除" }).click();
  await expect(page.locator("#config-status")).toHaveText("页面整体规则已删除。");
  await expect(page.locator(".page-rule-item")).toHaveCount(0);

  await page.getByRole("button", { name: "个性化规则" }).click();
  await page.getByRole("button", { name: "新建规则" }).click();
  await expect(page.locator(".split-workspace")).toHaveAttribute("data-editor-open", "true");
  await page.locator("#personal-name").fill("未绑定风险上下文的草稿");
  await page.locator("#personal-hostname").fill("example.com");
  await page.locator("#personal-sensitive").check();
  await page.getByRole("button", { name: "保存规则" }).click();
  await expect(page.locator("#config-status")).toContainText("请从当前站点、页面或已有规则进入");
  await expect(page.locator("#risk-hostname")).toHaveValue("");
  await expect(page.getByRole("button", { name: "解锁" })).toBeDisabled();
  await expect(page.locator("#personal-name")).toHaveValue("未绑定风险上下文的草稿");
  await page.locator("#close-personal-editor").click();
  await expect(page.locator(".split-workspace")).toHaveAttribute("data-editor-open", "false");
});

test("基础内容链接默认新标签，页面个性化规则可恢复原生", async ({ context, extensionId }) => {
  const source = await context.newPage();
  await source.goto(`${FIXTURE}/e2e-navigation.html`);

  const pageCountBeforeFavorite = context.pages().length;
  await source.getByTestId("favorite-action").click();
  await expect(source.getByTestId("favorite-state")).toHaveText("已收藏");
  await expect(source).toHaveURL(`${FIXTURE}/e2e-navigation.html`);
  expect(context.pages()).toHaveLength(pageCountBeforeFavorite);

  const opened = context.waitForEvent("page");
  await source.getByTestId("plain-link").click();
  const destination = await opened;
  await destination.waitForLoadState();
  await expect(destination.getByTestId("destination")).toBeVisible();
  await expect(source).toHaveURL(`${FIXTURE}/e2e-navigation.html`);
  await destination.close();

  const topicRowOpened = context.waitForEvent("page");
  await source.getByTestId("topic-row-blank").click();
  const topicDestination = await topicRowOpened;
  await topicDestination.waitForLoadState();
  await expect(topicDestination).toHaveURL(`${FIXTURE}/destination.html?from=topic-row`);
  await expect(source).toHaveURL(`${FIXTURE}/e2e-navigation.html`);
  await topicDestination.close();

  const pageKey = `${FIXTURE}/e2e-navigation.html`;
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  await control.evaluate(async ({ pageKey, target }) => {
    await chrome.runtime.sendMessage({
      type: "plm:upsert-personal-rule",
      rule: {
        id: "e2e-native-rule",
        name: "E2E native",
        enabled: true,
        scope: { type: "page", pageKey, hostname: "127.0.0.1" },
        order: 0,
        action: "preserve-native",
        match: { targetUrl: { kind: "exact", value: target } },
        sensitiveEnabled: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  }, { pageKey, target: `${FIXTURE}/destination.html` });
  await source.reload();
  await source.getByTestId("plain-link").click();
  await expect(source.getByTestId("destination")).toBeVisible();

  const records = await control.evaluate(async () => chrome.runtime.sendMessage({ type: "plm:get-debug-records" }));
  expect(records.some((record: { winningRuleId?: string; applied: boolean }) => record.winningRuleId === "e2e-native-rule" && !record.applied)).toBe(true);
  expect(records.some((record: { bypassReason?: string; applied: boolean }) => record.bypassReason === "frontend-action-control" && !record.applied)).toBe(true);
});

test("敏感表单与特殊窗口默认原生，最广预设只接管普通脚本打开", async ({ context, extensionId }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options.html`);
  await applyWidestPreset(options);

  const source = await context.newPage();
  await source.goto(`${FIXTURE}/e2e-navigation.html`);
  const opened = context.waitForEvent("page");
  await source.getByTestId("open-self").click();
  const scriptDestination = await opened;
  await expect(scriptDestination.getByTestId("destination")).toBeVisible();
  await expect(source).toHaveURL(`${FIXTURE}/e2e-navigation.html`);
  await scriptDestination.close();

  const popup = context.waitForEvent("page");
  await source.getByTestId("open-popup").click();
  const popupPage = await popup;
  await expect(popupPage.getByTestId("destination")).toBeVisible();
  await popupPage.close();

  await source.getByTestId("login-form").getByRole("button", { name: "Login" }).click();
  await expect(source.getByTestId("login")).toBeVisible();

  const records = await options.evaluate(async () => chrome.runtime.sendMessage({ type: "plm:get-debug-records" }));
  expect(records.some((record: { category: string; resolvedBy: string; applied: boolean }) => record.category === "form-auth-payment" && record.resolvedBy === "risk" && !record.applied)).toBe(true);
  expect(records.some((record: { category: string; resolvedBy: string; applied: boolean }) => record.category === "open-popup-named" && record.resolvedBy === "capability" && !record.applied)).toBe(true);
});

test("开放 Shadow DOM、SVG、iframe 和 frameset 中的链接进入真实接管链路", async ({ context, extensionId }) => {
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  await clearDebugRecords(control);
  const page = await context.newPage();
  await page.goto(`${FIXTURE}/shadow-svg.html`);
  await waitForContentReady(control, `${FIXTURE}/shadow-svg.html`);
  const shadowOpened = context.waitForEvent("page");
  await page.getByTestId("shadow-link").click();
  const shadowPage = await shadowOpened;
  await expect(shadowPage).toHaveURL(/legacy-table\.html\?from=shadow/);
  await shadowPage.close();

  const svgOpened = context.waitForEvent("page");
  await page.getByTestId("svg-link").click();
  const svgPage = await svgOpened;
  await expect(svgPage).toHaveURL(/modern-spa\.html\?from=svg/);
  await svgPage.close();

  await page.goto(`${FIXTURE}/legacy-frameset.html`);
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  const contentFrame = page.frames().find((frame) => frame.url().includes("frame-content.html"));
  expect(contentFrame).toBeTruthy();
  const frameOpened = context.waitForEvent("page");
  await contentFrame!.getByTestId("frame-content-link").click();
  const framePage = await frameOpened;
  await expect(framePage).toHaveURL(/modern-spa\.html\?from=frame/);
});

test("Popup 显示当前命中来源并实时应用预设，提供站点和页面独立深链", async ({ context, extensionId }, testInfo) => {
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  const sourceUrl = `${FIXTURE}/e2e-navigation.html`;
  await send(control, { type: "plm:set-page-rule", url: sourceUrl, mode: "new-tab" });
  await send(control, {
    type: "plm:upsert-personal-rule",
    rule: {
      id: "popup-site-rule",
      name: "Popup count rule",
      enabled: true,
      scope: { type: "site", hostname: "127.0.0.1" },
      order: 0,
      action: "new-tab",
      match: { targetUrl: { kind: "prefix", value: `${FIXTURE}/` } },
      sensitiveEnabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  });

  const source = await context.newPage();
  await source.goto(sourceUrl);
  const recentDestination = await openPageFrom(context, () => source.getByTestId("plain-link").click());
  await expect(recentDestination).toHaveURL(`${FIXTURE}/destination.html`);
  await recentDestination.close();
  await waitForDebugRecord(control, (record) => record.resolvedBy === "page" && record.applied);
  const popup = await context.newPage();
  const consoleErrors: string[] = [];
  popup.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  popup.on("pageerror", (error) => consoleErrors.push(error.message));
  await control.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (tab?.id === undefined) throw new Error("未找到 Popup 对应的活动网页标签");
    await chrome.tabs.update(tab.id, { active: true });
  }, sourceUrl);
  await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);

  await expect(popup.locator("#status-label")).toHaveText("当前站点已托管");
  await expect(popup.locator("#host-value")).toHaveText("127.0.0.1");
  await expect(popup.locator("#page-rule-source")).toHaveText("新标签");
  await expect(popup.locator("#context-summary")).toContainText("当前页面整体使用新标签");
  await expect(popup.locator("#decision-source")).toHaveText("最近命中：页面整体 · 新标签");
  await expect(popup.locator("#personal-rule-count")).toHaveText("当前范围 1 条");

  await popup.setViewportSize({ width: 360, height: 700 });
  await expect(popup.locator("main")).toBeVisible();
  expect(await popup.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await popup.screenshot({ path: testInfo.outputPath("popup-fixed-360.png"), fullPage: true });

  const siteOptionsPromise = context.waitForEvent("page", {
    predicate: (page) => page.url().includes(`chrome-extension://${extensionId}/src/options.html`),
  });
  await popup.getByRole("button", { name: "站点规则" }).click();
  const siteOptions = await siteOptionsPromise;
  const siteDeepLink = new URL(siteOptions.url());
  expect(siteDeepLink.searchParams.get("view")).toBe("personal");
  expect(siteDeepLink.searchParams.get("scope")).toBe("site");
  expect(siteDeepLink.searchParams.get("hostname")).toBe("127.0.0.1");
  await expect(siteOptions.locator("#personal-scope-type")).toHaveValue("site");

  const pagePopup = await context.newPage();
  await control.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (tab?.id === undefined) throw new Error("未找到 Popup 对应的活动网页标签");
    await chrome.tabs.update(tab.id, { active: true });
  }, sourceUrl);
  await pagePopup.goto(`chrome-extension://${extensionId}/src/popup.html`);
  const pageOptionsPromise = context.waitForEvent("page", {
    predicate: (page) => page.url().includes(`chrome-extension://${extensionId}/src/options.html`) && page !== siteOptions,
  });
  await pagePopup.getByRole("button", { name: "页面规则" }).click();
  const pageOptions = await pageOptionsPromise;
  const pageDeepLink = new URL(pageOptions.url());
  expect(pageDeepLink.searchParams.get("scope")).toBe("page");
  expect(pageDeepLink.searchParams.get("page")).toBe(sourceUrl);
  await expect(pageOptions.locator("#personal-scope-type")).toHaveValue("page");

  const presetPopup = await context.newPage();
  await control.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (tab?.id === undefined) throw new Error("未找到 Popup 对应的活动网页标签");
    await chrome.tabs.update(tab.id, { active: true });
  }, sourceUrl);
  await presetPopup.goto(`chrome-extension://${extensionId}/src/popup.html`);
  const optionsPageCountBeforePreset = context.pages().filter((page) => page.url().includes(`chrome-extension://${extensionId}/src/options.html`)).length;
  const popupPresetRange = presetPopup.locator("#popup-preset-range");
  await popupPresetRange.focus();
  await popupPresetRange.press("Home");
  await popupPresetRange.press("End");
  await expect.poll(async () => (await send<{ presetId: string }>(control, { type: "plm:get-state" })).presetId).toBe("widest");
  await expect(presetPopup.locator("#popup-preset-label")).toHaveText("当前：最广");
  await expect.poll(() => context.pages().filter((page) => page.url().includes(`chrome-extension://${extensionId}/src/options.html`)).length).toBe(optionsPageCountBeforePreset);
  expect(consoleErrors).toEqual([]);
  await presetPopup.close();
});

test("调试记录可运行模拟并预填页面个性化规则", async ({ context, extensionId }) => {
  const sourceUrl = `${FIXTURE}/e2e-navigation.html`;
  const source = await context.newPage();
  await source.goto(sourceUrl);
  const destination = await openPageFrom(context, () => source.getByTestId("plain-link").click());
  await destination.close();

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options.html?view=debug`);
  await expect(options.locator(".debug-item")).toHaveCount(1);
  await options.getByRole("button", { name: "模拟", exact: true }).click();
  await expect(options.locator("#simulator-result")).toBeVisible();
  await expect(options.locator("#simulator-summary")).toContainText("最终动作");
  await expect(options.locator("#simulator-trace li[data-state='matched']")).toHaveCount(1);

  await options.getByRole("button", { name: "预填页面规则" }).click();
  await expect(options.locator("#personal-rule-editor")).toBeVisible();
  await expect(options.locator("#personal-scope-type")).toHaveValue("page");
  await expect(options.locator("#personal-hostname")).toHaveValue("127.0.0.1");
  await expect(options.locator("#personal-page-key")).toHaveValue(sourceUrl);
  await expect(options.locator("#personal-target-kind")).toHaveValue("exact");
  await expect(options.locator("#personal-target-value")).toHaveValue(`${FIXTURE}/destination.html`);
});

test("修饰键、中键、键盘、base target 与 SPA/hash 保持各自原生语义", async ({ context, extensionId }) => {
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  await clearDebugRecords(control);

  const source = await context.newPage();
  await source.goto(`${FIXTURE}/e2e-navigation.html`);

  const modified = await openPageFrom(context, () => source.getByTestId("plain-link").click({ modifiers: ["Control"] }));
  await expect(modified.getByTestId("destination")).toBeVisible();
  await modified.close();
  const middle = await openPageFrom(context, () => source.getByTestId("plain-link").click({ button: "middle" }));
  await expect(middle.getByTestId("destination")).toBeVisible();
  await middle.close();
  const keyboard = await openPageFrom(context, async () => {
    await source.getByTestId("plain-link").focus();
    await source.getByTestId("plain-link").press("Enter");
  });
  await expect(keyboard.getByTestId("destination")).toBeVisible();
  await keyboard.close();
  await expect(source).toHaveURL(`${FIXTURE}/e2e-navigation.html`);

  await expect.poll(async () => (await getDebugRecords(control)).filter((record) =>
    record.resolvedBy === "capability" && record.bypassReason === "explicit-user-intent",
  ).length).toBe(2);
  await waitForDebugRecord(control, (record) => record.trigger === "anchor" && record.applied && record.resolvedBy === "global-category");

  await source.goto(`${FIXTURE}/base-target.html`);
  const named = await openPageFrom(context, () => source.getByTestId("base-inherited-target").click());
  await expect(named).toHaveURL(/modern-spa\.html\?from=base/);
  await named.close();
  await waitForDebugRecord(control, (record) =>
    record.targetUrl.includes("modern-spa.html?from=base") && record.resolvedBy === "capability" && !record.applied,
  );

  const explicitSelf = await openPageFrom(context, () => source.getByTestId("base-explicit-self").click());
  await expect(explicitSelf).toHaveURL(/legacy-table\.html\?from=base/);
  await explicitSelf.close();
  await source.getByTestId("base-fragment").click();
  await expect(source).toHaveURL(`${FIXTURE}/#local-section`);

  await source.goto(`${FIXTURE}/modern-spa.html`);
  const pageCount = context.pages().length;
  await source.getByTestId("spa-push-state").click();
  await expect(source).toHaveURL(/\?view=pushed$/);
  await source.getByTestId("spa-hash-link").click();
  await expect(source).toHaveURL(/#settings$/);
  await expect(source.getByTestId("spa-view")).toContainText("#settings");
  expect(context.pages()).toHaveLength(pageCount);
});

test("GET 表单与普通 window.open 可接管，POST、弹窗和无激活脚本默认受限", async ({ context, extensionId }) => {
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  await applyWidestPreset(control);
  await send(control, { type: "plm:set-global-category-rule", category: "form-search-get", rule: "new-tab" });
  await clearDebugRecords(control);

  const source = await context.newPage();
  await source.goto(`${FIXTURE}/forms.html`);
  const getDestination = await openPageFrom(context, () => source.getByTestId("get-submit-basic").click());
  await expect(getDestination).toHaveURL(/forms\.html\?q=fixture&mode=basic/);
  await expect(source).toHaveURL(`${FIXTURE}/forms.html`);
  await getDestination.close();
  await waitForDebugRecord(control, (record) => record.category === "form-search-get" && record.applied);

  const countBeforePost = context.pages().length;
  await Promise.all([
    source.waitForNavigation(),
    source.getByTestId("post-submit").click(),
  ]);
  expect(context.pages()).toHaveLength(countBeforePost);
  await waitForDebugRecord(control, (record) =>
    record.category === "form-non-get" && record.resolvedBy === "risk" && !record.applied,
  );

  await source.goto(`${FIXTURE}/e2e-navigation.html`);
  const ordinaryOpen = await openPageFrom(context, () => source.getByTestId("open-self").click());
  await expect(ordinaryOpen).toHaveURL(/destination\.html\?from=open/);
  await ordinaryOpen.close();
  const popupOpen = await openPageFrom(context, () => source.getByTestId("open-popup").click());
  await expect(popupOpen).toHaveURL(/destination\.html\?from=popup/);
  await popupOpen.close();
  await waitForDebugRecord(control, (record) => record.category === "open-popup-named" && record.resolvedBy === "capability");

  await source.reload();
  await source.waitForTimeout(6_000);
  const pagesBeforePassive = new Set(context.pages());
  const cdp = await context.newCDPSession(source);
  const passiveEvaluation = await cdp.send("Runtime.evaluate", {
    expression: `({ active: navigator.userActivation.isActive, opened: Boolean(window.open("destination.html?from=passive", "_blank")) })`,
    returnByValue: true,
    userGesture: false,
  });
  expect(passiveEvaluation.result.value.active).toBe(false);
  const passiveRecord = await waitForDebugRecord(control, (record) => record.targetUrl.includes("from=passive"));
  expect(passiveRecord).toMatchObject({
    applied: false,
    bypassReason: "script-without-user-activation",
    resolvedBy: "capability",
  });
  for (const page of context.pages()) {
    if (!pagesBeforePassive.has(page) && !page.isClosed()) await page.close();
  }
});

test("高风险规则需逐站解锁和逐条启用，撤销后立即停用", async ({ context, extensionId }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options.html?view=personal&scope=site&hostname=127.0.0.1`);
  const source = await context.newPage();
  await source.goto(`${FIXTURE}/forms.html`);
  await expect(options.locator("#risk-state")).toHaveText("默认关闭");
  await options.getByRole("button", { name: "解锁" }).click();
  const dialog = options.getByRole("dialog", { name: "解锁高风险规则" });
  await expect(dialog).toContainText("重复提交、登录失败或支付流程中断");
  await dialog.locator("#risk-acknowledge").check();
  await dialog.locator("#risk-confirm-hostname").fill("127.0.0.1");
  await dialog.getByRole("button", { name: "解锁站点" }).click();
  await expect(options.locator("#risk-state")).toHaveText("本机已解锁");

  await options.getByRole("button", { name: "新建规则" }).click();
  await options.locator("#personal-name").fill("POST 新标签");
  await options.locator("#personal-hostname").fill("127.0.0.1");
  await options.locator("#personal-target-kind").selectOption("exact");
  await options.locator("#personal-target-value").fill(`${FIXTURE}/forms.html`);
  await options.locator("#personal-triggers input[value='form']").check();
  await options.locator("#personal-form-methods input[value='POST']").check();
  await options.locator("#personal-action button[data-value='new-tab']").click();
  await options.locator("#personal-sensitive").check();
  await options.getByRole("button", { name: "保存规则" }).click();
  await expect(options.getByText("POST 新标签", { exact: true })).toBeVisible();

  const state = await send<{ personalRules: Array<StoredRule & { name: string }> }>(options, { type: "plm:get-state" });
  const sensitiveRule = state.personalRules.find((rule) => rule.name === "POST 新标签");
  expect(sensitiveRule).toMatchObject({ enabled: true, sensitiveEnabled: true });

  const destination = await openPageFrom(context, () => source.getByTestId("post-submit").click());
  await expect(destination).toHaveURL(`${FIXTURE}/forms.html`);
  await expect(source).toHaveURL(`${FIXTURE}/forms.html`);
  await destination.close();
  await waitForDebugRecord(options, (record) => record.winningRuleId === sensitiveRule!.id && record.applied);

  await options.getByRole("button", { name: "撤销" }).click();
  await expect(options.locator("#risk-state")).toHaveText("默认关闭");
  const revoked = await send<{ personalRules: StoredRule[] }>(options, { type: "plm:get-state" });
  expect(revoked.personalRules.find((rule) => rule.id === sensitiveRule!.id)).toMatchObject({ enabled: false, sensitiveEnabled: false });
  expect(await send(options, { type: "plm:get-risk-grant", hostname: "127.0.0.1" })).toBeNull();

  const countBeforeNativePost = context.pages().length;
  await Promise.all([
    source.waitForNavigation(),
    source.getByTestId("post-submit").click(),
  ]);
  expect(context.pages()).toHaveLength(countBeforeNativePost);
  await waitForDebugRecord(options, (record) => record.category === "form-non-get" && record.resolvedBy === "risk" && !record.applied);
});

test("导入隔离风险授权并禁用敏感规则", async ({ context, extensionId }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options.html`);
  const original = await send<Record<string, unknown> & { personalRules: unknown[] }>(options, { type: "plm:get-state" });
  const now = Date.now();
  const importedRule = {
    id: "imported-sensitive-rule",
    name: "导入敏感规则",
    enabled: true,
    scope: { type: "site", hostname: "localhost" },
    order: 0,
    action: "new-tab",
    match: { triggers: ["form"], formMethods: ["POST"] },
    sensitiveEnabled: true,
    createdAt: now,
    updatedAt: now,
  };
  const backup = {
    formatVersion: 1,
    extensionVersion: "0.6.1-test",
    exportedAt: new Date(now).toISOString(),
    riskGrants: { localhost: { hostname: "localhost", grantedAt: now, confirmationVersion: 1 } },
    state: { ...original, personalRules: [...original.personalRules, importedRule] },
  };

  await options.getByRole("button", { name: "配置备份" }).click();
  await options.locator("#import-config-input").setInputFiles({
    name: "pagelinkmode-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(options.locator("#config-status")).toContainText("敏感规则保持关闭");
  const imported = await send<{ personalRules: StoredRule[] }>(options, { type: "plm:get-state" });
  expect(imported.personalRules.find((rule) => rule.id === importedRule.id)).toMatchObject({ enabled: false, sensitiveEnabled: true });
  expect(await send(options, { type: "plm:get-risk-grant", hostname: "localhost" })).toBeNull();
  expect(await send<unknown[]>(options, { type: "plm:get-risk-grants" })).toEqual([]);
});

test("同作用域首条命中且页面规则优先于站点规则", async ({ context, extensionId }) => {
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  const sourceUrl = `${FIXTURE}/e2e-navigation.html`;
  const targetUrl = `${FIXTURE}/destination.html`;
  const createRule = (id: string, name: string, order: number, action: "same-tab" | "new-tab", scope: "site" | "page") => ({
    id,
    name,
    enabled: true,
    scope: scope === "page"
      ? { type: "page", hostname: "127.0.0.1", pageKey: sourceUrl }
      : { type: "site", hostname: "127.0.0.1" },
    order,
    action,
    match: { targetUrl: { kind: "exact", value: targetUrl } },
    sensitiveEnabled: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await send(control, { type: "plm:upsert-personal-rule", rule: createRule("site-first", "站点首条", 0, "new-tab", "site") });
  await send(control, { type: "plm:upsert-personal-rule", rule: createRule("site-second", "站点第二条", 1, "new-tab", "site") });

  const source = await context.newPage();
  await source.goto(sourceUrl);
  await clearDebugRecords(control);
  const siteFirst = await openPageFrom(context, () => source.getByTestId("plain-link").click());
  await expect(siteFirst).toHaveURL(targetUrl);
  await siteFirst.close();
  await waitForDebugRecord(control, (record) => record.winningRuleId === "site-first" && record.resolvedBy === "personal-site");

  await send(control, { type: "plm:reorder-personal-rules", firstId: "site-first", secondId: "site-second" });
  await source.goto(sourceUrl);
  await clearDebugRecords(control);
  const siteSecond = await openPageFrom(context, () => source.getByTestId("plain-link").click());
  await expect(siteSecond).toHaveURL(targetUrl);
  await siteSecond.close();
  await waitForDebugRecord(control, (record) => record.winningRuleId === "site-second" && record.resolvedBy === "personal-site");

  await send(control, { type: "plm:upsert-personal-rule", rule: createRule("page-first", "页面优先", 0, "new-tab", "page") });
  await source.reload();
  await clearDebugRecords(control);
  const pageFirst = await openPageFrom(context, () => source.getByTestId("plain-link").click());
  await expect(pageFirst).toHaveURL(targetUrl);
  await pageFirst.close();
  await waitForDebugRecord(control, (record) => record.winningRuleId === "page-first" && record.resolvedBy === "personal-page");
});

test("持久化 Chromium 重新加载扩展后继续使用本地配置", async ({}, testInfo) => {
  const extensionPath = path.resolve(process.cwd(), "dist");
  const profilePath = testInfo.outputPath("reload-profile");
  const launch = () => chromium.launchPersistentContext(profilePath, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const firstContext = await launch();
  const firstExtensionId = await getExtensionId(firstContext);
  const firstOptions = await firstContext.newPage();
  await firstOptions.goto(`chrome-extension://${firstExtensionId}/src/options.html`);
  await send(firstOptions, { type: "plm:set-site-rule", hostname: "127.0.0.1", mode: "new-tab" });
  await send(firstOptions, {
    type: "plm:upsert-personal-rule",
    rule: {
      id: "reload-local-rule",
      name: "重载后保留",
      enabled: true,
      scope: { type: "site", hostname: "127.0.0.1" },
      order: 0,
      action: "new-tab",
      match: { targetUrl: { kind: "prefix", value: `${FIXTURE}/` } },
      sensitiveEnabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  });
  await firstContext.close();

  const secondContext = await launch();
  try {
    const secondExtensionId = await getExtensionId(secondContext);
    expect(secondExtensionId).toBe(firstExtensionId);
    const secondOptions = await secondContext.newPage();
    await secondOptions.goto(`chrome-extension://${secondExtensionId}/src/options.html`);
    const persisted = await send<{
      siteRules: Record<string, string>;
      personalRules: StoredRule[];
    }>(secondOptions, { type: "plm:get-state" });
    expect(persisted.siteRules["127.0.0.1"]).toBe("new-tab");
    expect(persisted.personalRules.find((rule) => rule.id === "reload-local-rule")).toMatchObject({
      enabled: true,
      sensitiveEnabled: false,
    });
  } finally {
    await secondContext.close();
  }
});
