import { resolve } from "node:path";
import { verifyArtifacts, verifyBuiltDist, writeVerifiedDistZip } from "./dist-zip.mjs";

const rootDir = process.cwd();
const distDir = resolve(rootDir, "dist");
const zipPath = resolve(rootDir, "dist.zip");

try {
  await verifyBuiltDist(rootDir, distDir);
  const packaged = await writeVerifiedDistZip(distDir, zipPath);
  const verified = await verifyArtifacts(rootDir);
  console.log(`dist.zip 已生成并通过逐文件校验：${verified.fileCount} 个文件，${packaged.byteLength} 字节。`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
