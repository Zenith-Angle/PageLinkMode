import { resolve } from "node:path";
import { verifyArtifacts, verifySourceVersions } from "./dist-zip.mjs";

const rootDir = process.cwd();
const sourceOnly = process.argv.includes("--source-only");

try {
  if (sourceOnly) {
    const result = await verifySourceVersions(rootDir);
    console.log(`源码版本门禁通过：package、lock、public manifest 与 README badge 均为 ${result.version}。`);
  } else {
    const result = await verifyArtifacts(rootDir, {
      distDir: resolve(rootDir, "dist"),
      zipPath: resolve(rootDir, "dist.zip"),
    });
    console.log(
      `交付产物门禁通过：版本 ${result.version}，dist/zip 同源且逐字节一致，共 ${result.fileCount} 个文件、${result.byteLength} 字节。`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
