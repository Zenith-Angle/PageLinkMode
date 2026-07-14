import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("0.6.1 默认托管全部普通网站，并保持版本号一致", () => {
  const manifest = readJson("public/manifest.json");
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");

  assert.deepEqual(manifest.host_permissions, ["http://*/*", "https://*/*"]);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.version, "0.6.1");
  assert.equal(packageJson.version, "0.6.1");
  assert.equal(packageLock.version, "0.6.1");
  assert.equal(packageLock.packages[""].version, "0.6.1");
  assert.match(readFileSync("README.md", "utf8"), /release-v0\.6\.1(?:-|\))/);
});

test("交付目录拒绝测试、日志、临时、环境变量和密钥类文件", async () => {
  const { validateDistDirectory } = await loadDistZipModule();

  for (const forbiddenPath of [
    "assets/options.js.map",
    "assets/navigation.test.js",
    "runtime.log",
    "cache.tmp",
    "manifest.json.bak",
    ".env",
    "credentials.json",
    "private-key.pem",
  ]) {
    const fixture = await createDistFixture();
    try {
      const absolutePath = resolve(fixture, forbiddenPath);
      await mkdir(resolve(absolutePath, ".."), { recursive: true });
      await writeFile(absolutePath, "sensitive", "utf8");
      await assert.rejects(
        validateDistDirectory(fixture),
        new RegExp(forbiddenPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      );
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  }
});

test("候选 ZIP 未通过校验时不得覆盖已有正式包", async () => {
  const { writeVerifiedDistZip } = await loadDistZipModule();
  const fixture = await createDistFixture();
  const zipPath = join(fixture, "..", `${Date.now()}-dist.zip`);
  const originalArchive = Buffer.from("previous-valid-archive");

  try {
    await writeFile(zipPath, originalArchive);
    await writeFile(join(fixture, ".env"), "TOKEN=do-not-package", "utf8");
    await assert.rejects(writeVerifiedDistZip(fixture, zipPath), /\.env/i);
    assert.deepEqual(await readFile(zipPath), originalArchive);
  } finally {
    await rm(fixture, { recursive: true, force: true });
    await rm(zipPath, { force: true });
  }
});

test("在所有 frame 的文档起始阶段分别注入 MAIN bridge 和隔离 content script", () => {
  const manifest = readJson("public/manifest.json");
  const contentScripts = manifest.content_scripts as Array<Record<string, any>>;
  const pageBridge = contentScripts.find((entry) =>
    (entry.js as string[] | undefined)?.includes("js/page-bridge.js"),
  );
  const isolatedContent = contentScripts.find((entry) =>
    (entry.js as string[] | undefined)?.includes("js/content.js"),
  );

  assert.ok((manifest.permissions as string[]).includes("webNavigation"));
  assert.ok(pageBridge, "应声明 MAIN world page bridge");
  assert.deepEqual(pageBridge.js, ["js/page-bridge.js"]);
  assert.equal(pageBridge.world, "MAIN");
  assert.equal(pageBridge.run_at, "document_start");
  assert.equal(pageBridge.all_frames, true);
  assert.equal(pageBridge.match_about_blank, true);
  assert.equal(pageBridge.match_origin_as_fallback, true);

  assert.ok(isolatedContent, "应声明隔离世界 content script");
  assert.deepEqual(isolatedContent.js, ["js/content.js"]);
  assert.equal(isolatedContent.world, undefined);
  assert.equal(isolatedContent.run_at, "document_start");
  assert.equal(isolatedContent.all_frames, true);
  assert.equal(isolatedContent.match_about_blank, true);
  assert.equal(isolatedContent.match_origin_as_fallback, true);
});

test("page bridge 不再作为 web accessible resource 暴露给页面", () => {
  const manifest = readJson("public/manifest.json");
  const exposedResources = (
    (manifest.web_accessible_resources ?? []) as Array<{ resources?: string[] }>
  ).flatMap((entry) => entry.resources ?? []);

  assert.equal(exposedResources.includes("js/page-bridge.js"), false);
});

test("红绿状态图标提供 16px 和 32px 的圆点版本", () => {
  for (const state of ["managed", "unmanaged"]) {
    assert.deepEqual(readPngSize(`public/icons/icon16-${state}.png`), [16, 16]);
    assert.deepEqual(readPngSize(`public/icons/icon32-${state}.png`), [32, 32]);
  }
});

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
}

function readPngSize(path: string): [number, number] {
  const data = readFileSync(path);
  assert.equal(data.subarray(1, 4).toString("ascii"), "PNG");
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

async function createDistFixture(): Promise<string> {
  const fixture = await mkdtemp(join(tmpdir(), "pagelinkmode-artifact-"));
  await mkdir(join(fixture, "js"), { recursive: true });
  await writeFile(
    join(fixture, "manifest.json"),
    JSON.stringify({ manifest_version: 3, version: "0.6.1" }),
    "utf8",
  );
  await writeFile(join(fixture, "js", "background.js"), "void 0;", "utf8");
  return fixture;
}

async function loadDistZipModule(): Promise<{
  validateDistDirectory: (distDir: string) => Promise<unknown>;
  writeVerifiedDistZip: (distDir: string, zipPath: string) => Promise<unknown>;
}> {
  // 构建脚本保持原生 ESM；测试仅声明其公开门禁接口，避免为脚本引入额外类型文件。
  // @ts-expect-error JavaScript 构建脚本没有单独的声明文件。
  return import("../scripts/dist-zip.mjs");
}
