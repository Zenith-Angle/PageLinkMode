import { copyFile, cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { build as viteBuild } from "vite";
import esbuild from "esbuild";
import { validateDistDirectory, verifyBuiltDist, verifySourceVersions } from "./dist-zip.mjs";

const rootDir = process.cwd();
const distDir = resolve(rootDir, "dist");
const stagingDir = resolve(rootDir, ".build-dist");

async function prepareStagingDirectory() {
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
}

async function copyStaticFiles() {
  await cp(resolve(rootDir, "public"), stagingDir, { recursive: true });
}

async function buildExtensionScripts() {
  await esbuild.build({
    entryPoints: {
      background: resolve(rootDir, "src/background/index.ts"),
      content: resolve(rootDir, "src/content/index.ts"),
      "page-bridge": resolve(rootDir, "src/content/page-bridge.ts"),
    },
    bundle: true,
    format: "iife",
    minify: false,
    platform: "browser",
    target: ["chrome114"],
    outdir: resolve(stagingDir, "js"),
    entryNames: "[name]",
    logLevel: "info",
  });
}

async function buildUiPages() {
  await viteBuild({
    configFile: resolve(rootDir, "vite.config.ts"),
    build: {
      outDir: stagingDir,
      emptyOutDir: false,
    },
  });
}

async function publishStagedFiles(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true });

  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const sourcePath = resolve(sourceDir, entry.name);
    const targetPath = resolve(targetDir, entry.name);
    if (entry.isDirectory()) {
      await publishStagedFiles(sourcePath, targetPath);
      continue;
    }

    // Chrome 正从 dist 读取资源；先写同目录临时文件再替换，避免出现资源不存在的窗口。
    const temporaryPath = resolve(dirname(targetPath), `.${basename(targetPath)}.pagelinkmode-tmp`);
    await copyFile(sourcePath, temporaryPath);
    await rename(temporaryPath, targetPath);
  }
}

async function removeStalePublishedFiles(sourceDir, targetDir) {
  const sourceEntries = new Map(
    (await readdir(sourceDir, { withFileTypes: true })).map((entry) => [entry.name, entry]),
  );

  for (const targetEntry of await readdir(targetDir, { withFileTypes: true })) {
    const targetPath = resolve(targetDir, targetEntry.name);
    const sourceEntry = sourceEntries.get(targetEntry.name);
    if (!sourceEntry || sourceEntry.isDirectory() !== targetEntry.isDirectory()) {
      await rm(targetPath, { recursive: true, force: true });
      continue;
    }

    if (targetEntry.isDirectory()) {
      await removeStalePublishedFiles(resolve(sourceDir, targetEntry.name), targetPath);
      if ((await readdir(targetPath)).length === 0) {
        await rm(targetPath, { recursive: true, force: true });
      }
    }
  }
}

async function main() {
  await verifySourceVersions(rootDir);
  await prepareStagingDirectory();
  try {
    await copyStaticFiles();
    await buildExtensionScripts();
    await buildUiPages();
    await validateDistDirectory(stagingDir);
    await verifyBuiltDist(rootDir, stagingDir);
    await publishStagedFiles(stagingDir, distDir);
    // 新文件全部可用后再清理旧哈希资源，兼顾正在运行的扩展与纯净交付产物。
    await removeStalePublishedFiles(stagingDir, distDir);
    await verifyBuiltDist(rootDir, distDir);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
