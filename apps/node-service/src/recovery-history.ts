// Bounded, durable recovery audit history. Keep writes serialized to avoid losing events.
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

export interface RecoveryEvent {
  cameraId: string;
  at: string;
  outcome: "success" | "failure";
  detail: string;
}
const directory = path.join(process.cwd(), "data");
const file = path.join(directory, "capture-recovery-history.json");
const limit = 100;
let queue = Promise.resolve();

export function readRecoveryHistory(): RecoveryEvent[] {
  try {
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(data)) return [];
    return data.filter((event): event is RecoveryEvent =>
      event !== null && typeof event === "object" &&
      typeof event.cameraId === "string" && typeof event.at === "string" &&
      (event.outcome === "success" || event.outcome === "failure") &&
      typeof event.detail === "string").slice(-limit);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Unable to load capture recovery history:", error);
    }
    return [];
  }
}

export function appendPersistentRecoveryEvent(event: RecoveryEvent): void {
  queue = queue.then(() => {
    const history = [...readRecoveryHistory(), event].slice(-limit);
    mkdirSync(directory, { recursive: true });
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(history, null, 2), "utf8");
    renameSync(temp, file);
  }).catch(error => {
    console.error("Unable to save capture recovery history:", error);
  });
}
