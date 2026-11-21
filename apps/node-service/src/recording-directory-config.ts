import path from "node:path";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";

/** Recording directory persists independently of tournament configuration or backup/restore. */
export function loadRecordingDestination(configFile: string, fallback: string): string {
  try {
    const value: unknown = JSON.parse(readFileSync(configFile, "utf8"));
    if (value && typeof value === "object" && "directory" in value &&
        typeof value.directory === "string" && path.isAbsolute(value.directory)) return path.normalize(value.directory);
  } catch { /* First launch uses the project recordings folder. */ }
  return fallback;
}
export async function validateRecordingDestination(raw: unknown): Promise<string> {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 1024 || !path.isAbsolute(raw))
    throw new Error("Choose an absolute recording folder path.");
  const directory = path.normalize(raw.trim());
  await mkdir(directory, { recursive: true });
  const info = await stat(directory);
  if (!info.isDirectory()) throw new Error("Recording destination must be a directory.");
  return directory;
}
export function persistRecordingDestination(configFile: string, directory: string): void {
  const temporary = `${configFile}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({version: 1, directory}, null, 2), {mode: 0o600});
  renameSync(temporary, configFile);
}
/** Read-only folder choices for a local operator. Never expose file contents. */
export async function listRecordingDirectories(raw: unknown): Promise<{path: string; folders: string[]}> {
  if (typeof raw !== "string" || !path.isAbsolute(raw) || raw.length > 1024)
    throw new Error("Choose an absolute directory path.");
  const directory = path.normalize(raw);
  const folders = (await readdir(directory, {withFileTypes: true}))
    .filter(item => item.isDirectory() && !item.isSymbolicLink())
    .map(item => item.name).sort((a,b) => a.localeCompare(b)).slice(0, 200);
  return {path: directory, folders};
}

/** Drives shown in the recording folder selector, without reading file contents. */
export async function listRecordingRoots(): Promise<string[]> {
  if (process.platform !== "win32") return ["/"];
  const roots: string[] = [];
  for (let code = 65; code <= 90; code++) {
    const drive = `${String.fromCharCode(code)}:\\`;
    try { if ((await stat(drive)).isDirectory()) roots.push(drive); } catch { /* Drive is absent or inaccessible. */ }
  }
  return roots;
}
