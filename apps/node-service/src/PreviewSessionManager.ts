
export interface PreviewSession {
  cameraId: string;
  cameraName: string;
  startedAt: string;
  status: "starting" | "running" | "stopped" | "error";
}

export class PreviewSessionManager {
  private sessions = new Map<string, PreviewSession>();

  start(cameraId: string, cameraName: string): PreviewSession {
    const existing = this.sessions.get(cameraId);

    if (existing) {
      return existing;
    }

    const session: PreviewSession = {
        cameraId,
        cameraName,
        startedAt: new Date().toISOString(),
        status: "starting"
    };

    this.sessions.set(cameraId, session);

    return session;
  }

  stop(cameraId: string): boolean {
    return this.sessions.delete(cameraId);
  }

  get(cameraId: string): PreviewSession | undefined {
    return this.sessions.get(cameraId);
  }

  list(): PreviewSession[] {
    return Array.from(this.sessions.values());
  }

setStatus(
  cameraId: string,
  status: PreviewSession["status"]
): boolean {
  const session = this.sessions.get(cameraId);

  if (!session) {
    return false;
  }

  session.status = status;
  return true;
}

}
