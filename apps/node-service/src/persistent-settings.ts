import fs from "node:fs";
import path from "node:path";

// Non-secret preferences only. Never place stream keys in this file.
export interface DevicePreference { alias?: string; hidden?: boolean; pairedMicrophoneId?: string }
export interface AppSettings {
  version: 1;
  network: { mode: "offline" | "tailscale" | "lan"; bindAddress: string };
  devices: Record<string, DevicePreference>;
}
const configDir = path.resolve(process.env.TOURNAMENT_CONFIG_DIR || path.join(process.cwd(), "config"));
const settingsFile = path.join(configDir, "settings.json");
const defaults = (): AppSettings => ({ version: 1, network: { mode: "offline", bindAddress: "127.0.0.1" }, devices: {} });
function validAddress(address: string): boolean {
  return address === "127.0.0.1" || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address) || /^[a-fA-F0-9:]+$/.test(address);
}
export function validateSettings(value: unknown): AppSettings {
  if (!value || typeof value !== "object") throw new Error("Settings must be an object");
  const v = value as Partial<AppSettings>;
  if (v.version !== 1 || !v.network || !["offline", "tailscale", "lan"].includes(v.network.mode) ||
      typeof v.network.bindAddress !== "string" || !validAddress(v.network.bindAddress)) throw new Error("Invalid network settings");
  if (!v.devices || typeof v.devices !== "object" || Array.isArray(v.devices) || Object.keys(v.devices).length > 256) throw new Error("Invalid device settings");
  const devices: Record<string, DevicePreference> = {};
  for (const [id, preference] of Object.entries(v.devices)) {
    if (!id || id.length > 1024 || !preference || typeof preference !== "object") throw new Error("Invalid device preference");
    if (preference.alias !== undefined && (typeof preference.alias !== "string" || preference.alias.length > 100)) throw new Error("Invalid alias");
    if (preference.hidden !== undefined && typeof preference.hidden !== "boolean") throw new Error("Invalid hidden flag");
    if (preference.pairedMicrophoneId !== undefined && (typeof preference.pairedMicrophoneId !== "string" || preference.pairedMicrophoneId.length > 1024)) throw new Error("Invalid microphone pairing");
    devices[id] = { alias: preference.alias, hidden: preference.hidden, pairedMicrophoneId: preference.pairedMicrophoneId };
  }
  return { version: 1, network: { ...v.network }, devices };
}
export function getSettings(): AppSettings {
  if (!fs.existsSync(settingsFile)) return defaults();
  return validateSettings(JSON.parse(fs.readFileSync(settingsFile, "utf8")));
}
export function saveSettings(value: unknown): AppSettings {
  const settings = validateSettings(value);
  fs.mkdirSync(configDir, { recursive: true });
  const temp = settingsFile + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, settingsFile);
  return settings;
}
export function getNetworkBindAddress(): string {
  const { network } = getSettings();
  if (network.mode === "offline") return "127.0.0.1";
  if (network.bindAddress === "127.0.0.1") throw new Error("Select a specific LAN or Tailscale interface address before enabling remote access");
  if (network.bindAddress === "0.0.0.0" || network.bindAddress === "::") throw new Error("Wildcard network binding is not allowed");
  return network.bindAddress;
}
export function exportBackup(session: unknown): { format: string; settings: AppSettings; session: unknown } {
  return { format: "tournament-backup-v1", settings: getSettings(), session };
}
