import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import esbuild from "esbuild";

const rootDir = process.cwd();
const tempDir = resolve(rootDir, ".test-dist");
const testEntries = [
  "src/lib/navigation.test.ts",
  "src/lib/storage.test.ts",
];

async function bundleTests() {
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  await Promise.all(
    testEntries.map((entry) =>
      esbuild.build({
        entryPoints: [resolve(rootDir, entry)],
        bundle: true,
        format: "esm",
        platform: "node",
        target: ["node24"],
        outfile: resolve(tempDir, entry.split("/").pop().replace(/\.ts$/, ".mjs")),
        logLevel: "silent",
      }),
    ),
  );
}

async function runNodeTests() {
  const bundledFiles = testEntries.map((entry) =>
    resolve(tempDir, entry.split("/").pop().replace(/\.ts$/, ".mjs")),
  );

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["--test", ...bundledFiles], {
      cwd: rootDir,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`测试失败，退出码 ${code ?? "null"}。`));
    });
    child.on("error", rejectPromise);
  });
}

async function main() {
  await bundleTests();
  await runNodeTests();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
