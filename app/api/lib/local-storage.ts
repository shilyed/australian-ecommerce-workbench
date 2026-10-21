import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

function storageRoot(): string {
  return path.resolve(env.storageDir);
}

function resolveKey(key: string): string {
  const root = storageRoot();
  const fullPath = path.resolve(root, key);
  if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) {
    throw new Error("非法文件路径");
  }
  return fullPath;
}

function sanitizeSegment(segment: string): string {
  const safe = Array.from(segment)
    .map(character =>
      character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character)
        ? "_"
        : character
    )
    .join("")
    .replace(/^\.+$/, "_")
    .slice(0, 180);
  return safe || "file";
}

function safeRelativeName(fileName: string): string {
  const segments = fileName
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map(sanitizeSegment);
  return segments.join("/");
}

export async function uploadLocalFile(input: {
  fileContent: Uint8Array;
  fileName: string;
  contentType?: string;
}) {
  const relativeName = safeRelativeName(input.fileName);
  const parsed = path.posix.parse(relativeName);
  const key = path.posix.join(
    parsed.dir,
    `${Date.now()}-${randomUUID()}-${parsed.base}`
  );
  const fullPath = resolveKey(key);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, input.fileContent, { mode: 0o600 });

  return {
    key,
    size: input.fileContent.byteLength,
    contentType: input.contentType || "application/octet-stream",
    etag: createHash("sha256").update(input.fileContent).digest("hex"),
  };
}

export function localFileUrl(key: string): string {
  return `/api/files?key=${encodeURIComponent(key)}`;
}

export async function readLocalFile(key: string): Promise<Uint8Array> {
  return readFile(resolveKey(key));
}

export async function deleteLocalFile(key: string): Promise<void> {
  await rm(resolveKey(key), { force: true });
}

export async function localFileExists(key: string): Promise<boolean> {
  try {
    const info = await stat(resolveKey(key));
    return info.isFile();
  } catch {
    return false;
  }
}
