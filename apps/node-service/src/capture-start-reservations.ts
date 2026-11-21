/** Process-local synchronous capture reservations. Not a cross-PC lease or fencing token. */
export type CaptureStartPath = "shared" | "legacy-recording";
export type CaptureStartIdentity = {
  cameraId: string;
  cameraName: string;
  cameraDeviceId?: string;
  microphoneName?: string;
  /** Verified Windows PnP instance ID, when explicitly mapped to this camera. */
  physicalDeviceId?: string;
};
export type ActiveCaptureIdentity = CaptureStartIdentity & { path: CaptureStartPath };
export type CaptureConflictField = "cameraId" | "cameraDeviceId" | "physicalDeviceId" | "cameraName" | "microphoneName";

export class CaptureStartConflict extends Error {
  readonly code = "CAPTURE_INPUT_BUSY";
  readonly owner: string;
  readonly field: CaptureConflictField;
  constructor(owner: string, field: CaptureConflictField) {
    super(`Capture input is already active or starting (${owner}; matching ${field}).`);
    this.owner = owner;
    this.field = field;
  }
}

const normalize = (value?: string) => (value ?? "").trim().toLowerCase();
/** dshow identifiers can arrive as `video=NAME` or just `NAME`. */
const videoIdentity = (value?: string) => normalize(value).replace(/^video\s*=\s*/, "");
const microphoneIdentity = (value?: string) => normalize(value).replace(/^audio\s*=\s*/, "");
const equalNonempty = (a: string, b: string) => a.length > 0 && b.length > 0 && a === b;

/** Only verified identity fields are compared. Never infer identity from controller or hub. */
export function captureInputCollision(a: CaptureStartIdentity, b: CaptureStartIdentity): CaptureConflictField | null {
  if (equalNonempty(normalize(a.cameraId), normalize(b.cameraId))) return "cameraId";
  if (equalNonempty(videoIdentity(a.cameraDeviceId), videoIdentity(b.cameraDeviceId))) return "cameraDeviceId";
  if (equalNonempty(normalize(a.physicalDeviceId), normalize(b.physicalDeviceId))) return "physicalDeviceId";
  // Identical model labels are normal for multiple USB cameras. Only bypass
  // the conservative name check when both inputs use distinct DirectShow IDs.
  const uniqueDirectShowId = (value?: string) => /^@device_(?:pnp|sw)_/.test(videoIdentity(value));
  const distinctDevices = uniqueDirectShowId(a.cameraDeviceId) && uniqueDirectShowId(b.cameraDeviceId) &&
    videoIdentity(a.cameraDeviceId) !== videoIdentity(b.cameraDeviceId);
  if (!distinctDevices && equalNonempty(normalize(a.cameraName), normalize(b.cameraName))) return "cameraName";
  if (equalNonempty(microphoneIdentity(a.microphoneName), microphoneIdentity(b.microphoneName))) return "microphoneName";
  return null;
}

export class CaptureStartReservations {
  private pending = new Map<symbol, ActiveCaptureIdentity>();

  private assertAvailable(candidate: ActiveCaptureIdentity, active: ActiveCaptureIdentity[]): void {
    for (const other of [...active, ...this.pending.values()]) {
      const field = captureInputCollision(candidate, other);
      if (field) throw new CaptureStartConflict(`${other.path}:${other.cameraId}`, field);
    }
  }

  reserve(path: CaptureStartPath, identity: CaptureStartIdentity, active: ActiveCaptureIdentity[]): () => void {
    const candidate = { ...identity, path };
    this.assertAvailable(candidate, active);
    const token = Symbol(identity.cameraId);
    this.pending.set(token, candidate);
    let released = false;
    return () => { if (!released) { released = true; this.pending.delete(token); } };
  }

  /** All-or-nothing batch reservation; no partially reserved cameras on conflict. */
  reserveBatch(path: CaptureStartPath, identities: CaptureStartIdentity[], active: ActiveCaptureIdentity[]): () => void {
    const releases: Array<() => void> = [];
    try {
      for (const identity of identities) releases.push(this.reserve(path, identity, active));
    } catch (error) {
      for (const release of releases.reverse()) release();
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const release of releases.reverse()) release();
    };
  }

  /** Reserve replacement before stopping the existing process. Only the exact
   * running shared camera is exempt; other active and pending inputs are not. */
  reserveReplacement(identity: CaptureStartIdentity, active: ActiveCaptureIdentity[]): () => void {
    const owner = active.find(item => item.path === "shared" &&
      equalNonempty(normalize(item.cameraId), normalize(identity.cameraId)));
    if (!owner) throw new CaptureStartConflict(`missing-active-shared:${identity.cameraId}`, "cameraId");
    return this.reserve("shared", identity, active.filter(item => item !== owner));
  }

  snapshot(): ActiveCaptureIdentity[] { return [...this.pending.values()].map(item => ({ ...item })); }
}
