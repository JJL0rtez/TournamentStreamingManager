import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Encryption key must be supplied by the operator and kept OUTSIDE the project/backup.
// Use a random 32-byte key encoded as 64 hexadecimal characters.
const file = path.resolve(process.env.TOURNAMENT_CONFIG_DIR || path.join(process.cwd(), "config"), "youtube-profiles.enc.json");
function key(): Buffer {
  const value = process.env.TOURNAMENT_STREAM_KEY_SECRET || "";
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error("Set TOURNAMENT_STREAM_KEY_SECRET to 64 hexadecimal characters before using saved YouTube profiles");
  return Buffer.from(value, "hex");
}
interface StoredProfile { cameraId: string; label: string; streamKey: string }
function read(): StoredProfile[] {
  const secret = key();
  if (!fs.existsSync(file)) return [];
  const blob = JSON.parse(fs.readFileSync(file, "utf8"));
  if (blob.version !== 1) throw new Error("Unsupported YouTube profile file version");
  const decipher = crypto.createDecipheriv("aes-256-gcm", secret, Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(blob.data, "base64")), decipher.final()]);
  const result = JSON.parse(plaintext.toString("utf8"));
  if (!Array.isArray(result)) throw new Error("Invalid saved profiles");
  return result;
}
function write(profiles: StoredProfile[]) {
  const secret = key();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(profiles), "utf8"), cipher.final()]);
  const blob = { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(blob) + "\n", { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function listYouTubeProfiles() { return read().map(({ cameraId, label }) => ({ cameraId, label, configured: true })); }
export function getYouTubeKey(cameraId: string) { return read().find(p => p.cameraId === cameraId)?.streamKey; }
export function saveYouTubeProfile(cameraId: string, label: string, streamKey: string) {
  if (!cameraId || cameraId.length > 1024 || !label || label.length > 120 || !streamKey || streamKey.length > 512) throw new Error("Invalid YouTube profile");
  const profiles = read().filter(p => p.cameraId !== cameraId);
  profiles.push({ cameraId, label, streamKey });
  if (profiles.length > 32) throw new Error("Maximum 32 profiles");
  write(profiles);
}
export function deleteYouTubeProfile(cameraId: string) { write(read().filter(p => p.cameraId !== cameraId)); }

// Import is atomic: validate all entries and encrypt the complete updated set once.
export function importYouTubeProfiles(value: unknown, replace = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid import document");
  const doc = value as { format?: unknown; profiles?: unknown };
  if (doc.format !== "tournament-youtube-keys-v1" || !Array.isArray(doc.profiles)) throw new Error("Unsupported YouTube key import format");
  if (doc.profiles.length > 32) throw new Error("Maximum 32 profiles");
  const imported: StoredProfile[] = [];
  const seen = new Set<string>();
  for (const raw of doc.profiles) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid profile entry");
    const p = raw as Partial<StoredProfile>;
    if (typeof p.cameraId !== "string" || !p.cameraId.trim() || p.cameraId.length > 1024 ||
        typeof p.label !== "string" || !p.label.trim() || p.label.length > 120 ||
        typeof p.streamKey !== "string" || !p.streamKey.trim() || p.streamKey.length > 512)
      throw new Error("Each profile requires cameraId, label and streamKey");
    if (seen.has(p.cameraId)) throw new Error("Duplicate cameraId in import");
    seen.add(p.cameraId);
    imported.push({ cameraId: p.cameraId, label: p.label, streamKey: p.streamKey });
  }
  const existing = replace ? [] : read().filter(p => !seen.has(p.cameraId));
  const combined = [...existing, ...imported];
  if (combined.length > 32) throw new Error("Maximum 32 profiles");
  write(combined);
  return { imported: imported.length, total: combined.length };
}
export function exportYouTubeProfileTemplate(cameraList: { id: string; name: string }[]) {
  return { format: "tournament-youtube-keys-v1", profiles: cameraList.slice(0, 32).map(c => ({ cameraId: c.id, label: c.name, streamKey: "" })) };
}
