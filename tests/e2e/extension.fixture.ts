import { test as base, chromium, type BrowserContext, type Worker } from "@playwright/test";
import path from "node:path";

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
};

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use, testInfo) => {
    const extensionPath = path.resolve(process.cwd(), "dist");
    const context = await chromium.launchPersistentContext(testInfo.outputPath("profile"), {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).hostname);
  },
});

export const expect = test.expect;
