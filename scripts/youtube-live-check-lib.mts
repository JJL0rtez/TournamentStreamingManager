export type RelaySnapshot = {
  active?: boolean;
  stream?: { status?: string; lastProgressAt?: number | null; progressAgeMs?: number | null; error?: string | null } | null;
  lastExit?: unknown;
  youtubeVerified?: boolean;
};
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv) {
  const value = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const cameraId = value("--camera") || env.TOURNAMENT_TEST_CAMERA_ID || "";
  if (!cameraId || cameraId.startsWith("--")) throw new Error("Specify --camera <cameraId> (logical ID, not display name).");
  const base = value("--base") || env.TOURNAMENT_API_BASE || "http://127.0.0.1:3001";
  const parsed = new URL(base);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) throw new Error("Live test must target local HTTP API only.");
  const goLive = argv.includes("--go-live");
  if (goLive && !argv.includes("--confirm-live-test")) throw new Error("Starting a real YouTube relay requires --confirm-live-test.");
  const durationSeconds = Number(value("--seconds") || "20");
  if (!Number.isInteger(durationSeconds) || durationSeconds < 6 || durationSeconds > 120) throw new Error("--seconds must be an integer from 6 to 120.");
  return { cameraId, base, goLive, durationSeconds };
}
export function classifyRelay(health: RelaySnapshot) {
  const active = health.active === true;
  const stream = health.stream;
  const progressing = active && typeof stream?.lastProgressAt === "number" && stream.lastProgressAt > 0 && (stream.progressAgeMs ?? Infinity) < 10000;
  return { active, progressing, error: stream?.status === "error" || Boolean(stream?.error) };
}
