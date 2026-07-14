import { randomUUID } from "node:crypto";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";

const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 33; // 1980-01-01，保证相同 dist 生成完全相同的 ZIP。

const ALLOWED_DIST_PATHS = [
  /^manifest\.json$/,
  /^src\/(?:options|popup)\.html$/,
  /^js\/(?:background|content|page-bridge)\.js$/,
  /^assets\/[A-Za-z0-9._-]+\.(?:css|js)$/,
  /^icons\/icon(?:16|32|48|128)(?:-(?:managed|unmanaged))?\.png$/,
];

const FORBIDDEN_DIST_PATHS = [
  { pattern: /\.map$/i, reason: "source map" },
  { pattern: /(?:^|\/)[^/]*\.(?:test|spec)\.[^/]+$/i, reason: "测试文件" },
  { pattern: /\.(?:log|tmp|bak|swp|orig)$/i, reason: "日志、临时或备份文件" },
  { pattern: /(?:^|\/)\.env(?:\.|$)/i, reason: "环境变量文件" },
  {
    pattern:
      /(?:^|\/)(?:credentials?|secrets?|private[-_.]?key|id_rsa|id_ed25519)(?:\.[^/]*)?$|\.(?:pem|key|p12|pfx|jks|keystore)$/i,
    reason: "密钥或凭据文件",
  },
];

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

async function collectDistFiles(distDir) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        const archivePath = relative(distDir, absolutePath).split(sep).join("/");
        files.push({ archivePath, absolutePath, data: await readFile(absolutePath) });
      } else {
        throw new Error(`交付目录包含不受支持的文件类型：${relative(distDir, absolutePath)}`);
      }
    }
  }

  await visit(distDir);
  return files.sort((left, right) => left.archivePath.localeCompare(right.archivePath, "en"));
}

function assertAllowedDistPath(archivePath) {
  for (const forbidden of FORBIDDEN_DIST_PATHS) {
    if (forbidden.pattern.test(archivePath)) {
      throw new Error(`交付目录包含禁止的${forbidden.reason}：${archivePath}`);
    }
  }

  if (!ALLOWED_DIST_PATHS.some((pattern) => pattern.test(archivePath))) {
    throw new Error(`交付目录包含白名单外文件：${archivePath}`);
  }
}

export async function validateDistDirectory(distDir) {
  const files = await collectDistFiles(distDir);
  if (files.length === 0) {
    throw new Error("dist 目录为空，拒绝生成或验收交付包。");
  }

  for (const file of files) assertAllowedDistPath(file.archivePath);

  const paths = new Set(files.map((file) => file.archivePath));
  for (const requiredPath of [
    "manifest.json",
    "src/options.html",
    "src/popup.html",
    "js/background.js",
    "js/content.js",
    "js/page-bridge.js",
  ]) {
    if (!paths.has(requiredPath)) throw new Error(`交付目录缺少必需文件：${requiredPath}`);
  }

  const manifestFile = files.find((file) => file.archivePath === "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(manifestFile.data.toString("utf8"));
  } catch {
    throw new Error("dist/manifest.json 不是有效 JSON。");
  }
  if (manifest.manifest_version !== 3 || typeof manifest.version !== "string") {
    throw new Error("dist/manifest.json 缺少有效的 MV3 版本信息。");
  }

  return { files, manifest };
}

export async function listDistFiles(distDir) {
  return (await validateDistDirectory(distDir)).files;
}

function parseJson(data, label) {
  try {
    return JSON.parse(data.toString("utf8"));
  } catch {
    throw new Error(`${label} 不是有效 JSON。`);
  }
}

export async function verifySourceVersions(rootDir) {
  const packagePath = resolve(rootDir, "package.json");
  const lockPath = resolve(rootDir, "package-lock.json");
  const manifestPath = resolve(rootDir, "public/manifest.json");
  const readmePath = resolve(rootDir, "README.md");
  const [packageData, lockData, manifestData, readmeData] = await Promise.all([
    readFile(packagePath),
    readFile(lockPath),
    readFile(manifestPath),
    readFile(readmePath, "utf8"),
  ]);
  const packageJson = parseJson(packageData, "package.json");
  const packageLock = parseJson(lockData, "package-lock.json");
  const manifest = parseJson(manifestData, "public/manifest.json");
  const version = packageJson.version;

  if (typeof version !== "string" || version.length === 0) {
    throw new Error("package.json 缺少有效版本号。");
  }
  const versions = [
    ["package-lock.json", packageLock.version],
    ["package-lock.json 根包", packageLock.packages?.[""]?.version],
    ["public/manifest.json", manifest.version],
  ];
  for (const [label, actual] of versions) {
    if (actual !== version) {
      throw new Error(`版本不一致：package.json=${version}，${label}=${actual ?? "缺失"}。`);
    }
  }
  if (!readmeData.includes(`release-v${version}-`)) {
    throw new Error(`README Release badge 未标记 v${version}。`);
  }

  return { version, manifestData };
}

export async function verifyBuiltDist(rootDir, distDir = resolve(rootDir, "dist")) {
  const source = await verifySourceVersions(rootDir);
  const validated = await validateDistDirectory(distDir);
  const distManifest = validated.files.find((file) => file.archivePath === "manifest.json");
  if (!distManifest.data.equals(source.manifestData)) {
    throw new Error("dist/manifest.json 与 public/manifest.json 字节不一致，请重新构建。");
  }
  if (validated.manifest.version !== source.version) {
    throw new Error(
      `构建产物版本不一致：源码=${source.version}，dist=${validated.manifest.version ?? "缺失"}。`,
    );
  }
  return { version: source.version, fileCount: validated.files.length };
}

export async function writeDistZip(distDir, zipPath) {
  const files = await listDistFiles(distDir);
  if (files.length > 0xffff) {
    throw new Error("dist 文件数量超过 ZIP32 支持范围。");
  }

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const file of files) {
    const name = Buffer.from(file.archivePath, "utf8");
    const checksum = crc32(file.data);
    if (name.length > 0xffff || file.data.length > 0xffffffff || localOffset > 0xffffffff) {
      throw new Error(`文件超出 ZIP32 支持范围：${file.archivePath}`);
    }

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(STORE_METHOD, 8);
    localHeader.writeUInt16LE(FIXED_DOS_TIME, 10);
    localHeader.writeUInt16LE(FIXED_DOS_DATE, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(file.data.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, file.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(STORE_METHOD, 10);
    centralHeader.writeUInt16LE(FIXED_DOS_TIME, 12);
    centralHeader.writeUInt16LE(FIXED_DOS_DATE, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(file.data.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + file.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  if (centralDirectory.length > 0xffffffff || localOffset > 0xffffffff) {
    throw new Error("dist.zip 超出 ZIP32 支持范围。");
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  const archive = Buffer.concat([...localParts, centralDirectory, end]);
  await writeFile(zipPath, archive);
  return { fileCount: files.length, byteLength: archive.length };
}

export async function writeVerifiedDistZip(distDir, zipPath) {
  const temporaryPath = resolve(
    dirname(zipPath),
    `.${basename(zipPath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    const packaged = await writeDistZip(distDir, temporaryPath);
    await verifyDistZip(distDir, temporaryPath);
    // 候选包与 dist 完整一致后才替换正式文件；临时文件位于同目录，重命名不会跨卷。
    await rename(temporaryPath, zipPath);
    return packaged;
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function findEndOfCentralDirectory(archive) {
  const minimumOffset = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("dist.zip 缺少有效的中央目录结束记录。");
}

function assertSafeArchivePath(archivePath) {
  if (
    archivePath.length === 0 ||
    archivePath.startsWith("/") ||
    archivePath.includes("\\") ||
    archivePath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`dist.zip 包含不安全路径：${archivePath}`);
  }
}

export async function verifyDistZip(distDir, zipPath) {
  const expectedFiles = await listDistFiles(distDir);
  const expected = new Map(expectedFiles.map((file) => [file.archivePath, file.data]));
  const archive = await readFile(zipPath);
  const endOffset = findEndOfCentralDirectory(archive);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  const commentLength = archive.readUInt16LE(endOffset + 20);

  if (endOffset + 22 + commentLength !== archive.length) throw new Error("dist.zip 尾部结构无效。");
  if (centralOffset + centralSize !== endOffset) throw new Error("dist.zip 中央目录边界无效。");
  if (entryCount !== expected.size) {
    throw new Error(`文件数量不一致：dist=${expected.size}，dist.zip=${entryCount}。`);
  }

  const seen = new Set();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error("dist.zip 中央目录条目无效。");
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const checksum = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const entryCommentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const archivePath = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    offset = nameStart + nameLength + extraLength + entryCommentLength;

    assertSafeArchivePath(archivePath);
    if (seen.has(archivePath)) throw new Error(`dist.zip 包含重复路径：${archivePath}`);
    seen.add(archivePath);
    if ((flags & UTF8_FLAG) === 0 || method !== STORE_METHOD || compressedSize !== uncompressedSize) {
      throw new Error(`dist.zip 条目格式不受支持：${archivePath}`);
    }
    if (archive.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`dist.zip 本地条目无效：${archivePath}`);
    }
    const localFlags = archive.readUInt16LE(localHeaderOffset + 6);
    const localMethod = archive.readUInt16LE(localHeaderOffset + 8);
    const localChecksum = archive.readUInt32LE(localHeaderOffset + 14);
    const localCompressedSize = archive.readUInt32LE(localHeaderOffset + 18);
    const localUncompressedSize = archive.readUInt32LE(localHeaderOffset + 22);
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localChecksum !== checksum ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize
    ) {
      throw new Error(`dist.zip 本地条目与中央目录不一致：${archivePath}`);
    }
    const localNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const localNameStart = localHeaderOffset + 30;
    const localName = archive.subarray(localNameStart, localNameStart + localNameLength).toString("utf8");
    if (localName !== archivePath) throw new Error(`dist.zip 条目路径不一致：${archivePath}`);
    const dataStart = localNameStart + localNameLength + localExtraLength;
    if (dataStart + uncompressedSize > centralOffset) {
      throw new Error(`dist.zip 条目数据越界：${archivePath}`);
    }
    const data = archive.subarray(dataStart, dataStart + uncompressedSize);
    if (data.length !== uncompressedSize || crc32(data) !== checksum) {
      throw new Error(`dist.zip 条目损坏：${archivePath}`);
    }

    const expectedData = expected.get(archivePath);
    if (!expectedData) throw new Error(`dist.zip 包含 dist 中不存在的文件：${archivePath}`);
    if (!data.equals(expectedData)) throw new Error(`文件字节不一致：${archivePath}`);
  }

  if (offset !== endOffset) throw new Error("dist.zip 中央目录大小与条目不一致。");
  for (const archivePath of expected.keys()) {
    if (!seen.has(archivePath)) throw new Error(`dist.zip 缺少文件：${archivePath}`);
  }
  return { fileCount: seen.size, byteLength: archive.length };
}

export async function verifyArtifacts(rootDir, options = {}) {
  const distDir = options.distDir ?? resolve(rootDir, "dist");
  const zipPath = options.zipPath ?? resolve(rootDir, "dist.zip");
  const built = await verifyBuiltDist(rootDir, distDir);
  if (options.requireZip === false) return built;
  const archive = await verifyDistZip(distDir, zipPath);
  return { ...built, byteLength: archive.byteLength };
}
