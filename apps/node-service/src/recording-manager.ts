
import { Recorder, type RecordingConfig } from "./recorder.js";

export interface RecordingSession {
  cameraId: string;
  cameraName: string;
  microphoneName: string;
  file: string;
  startedAt: string;
  durationSeconds: number;
}

export class RecordingManager {
  private recorders = new Map<string, Recorder>();
  private sessions = new Map<string, RecordingSession>();
  private pendingMicrophones = new Set<string>();
  private pendingCameras = new Set<string>();
  private pendingIds = new Set<string>();


  async start(
    cameraId: string,
    config: RecordingConfig
  ): Promise<RecordingSession> {
    if (this.recorders.has(cameraId) || this.pendingIds.has(cameraId)) {
      throw new Error(`Camera ${cameraId} is already recording.`);
    }

    const cameraInUse = [...this.sessions.values()].find(
      (session) => session.cameraName === config.cameraName
    );

    if (cameraInUse) {
      throw new Error(
        `Camera "${config.cameraName}" is already recording as "${cameraInUse.cameraId}".`
      );
    }


    const microphoneInUse = [...this.sessions.values()].find(
      (session) => session.microphoneName === config.microphoneName
    );

    if (microphoneInUse) {
      throw new Error(
        `Microphone "${config.microphoneName}" is already in use by camera "${microphoneInUse.cameraName}".`
      );
    }

    if (this.pendingMicrophones.has(config.microphoneName)) {
      throw new Error(
        `Microphone "${config.microphoneName}" is already starting another recording.`
      );
    }

    if (this.pendingCameras.has(config.cameraName)) {
      throw new Error(
        `Camera "${config.cameraName}" is already starting another recording.`
      );
    }

    this.pendingIds.add(cameraId);
    this.pendingCameras.add(config.cameraName);

    this.pendingMicrophones.add(config.microphoneName);



    const recorder = new Recorder();

    recorder.onExit = () => {
      if (this.recorders.get(cameraId) === recorder) {
        this.recorders.delete(cameraId);
        this.sessions.delete(cameraId);
        console.log(`Recording session cleaned up: ${cameraId}`);
      }
    };

    this.recorders.set(cameraId, recorder);


    try {
      const file = await recorder.start(config);

      
    const session: RecordingSession = {
    cameraId,
    cameraName: config.cameraName,
    microphoneName: config.microphoneName,
    file,
    startedAt: new Date().toISOString(),
    durationSeconds: 0
    };


      if (!recorder.isRecording) throw new Error(`Recording ${cameraId} exited during startup.`);
      this.sessions.set(cameraId, session);
      return session;

    
    } catch (error) {
      if (this.recorders.get(cameraId) === recorder) {
        this.recorders.delete(cameraId);
        this.sessions.delete(cameraId);
      }
      throw error;
    
    } finally {
      this.pendingIds.delete(cameraId);
      this.pendingCameras.delete(config.cameraName);
      this.pendingMicrophones.delete(config.microphoneName);
    }

  }


  async stop(cameraId: string): Promise<void> {
    const recorder = this.recorders.get(cameraId);

    if (!recorder) {
      throw new Error(`Camera ${cameraId} is not recording.`);
    }

    await recorder.stop();
    if (this.recorders.get(cameraId) === recorder) {
      this.recorders.delete(cameraId);
      this.sessions.delete(cameraId);
    }
  }

 private withDuration(session: RecordingSession): RecordingSession {
    return {
      ...session,
      durationSeconds: Math.floor(
        (Date.now() - new Date(session.startedAt).getTime()) / 1000
      )
    };
  }

  getStatus(cameraId: string): RecordingSession | null {
    const session = this.sessions.get(cameraId);
    return session ? this.withDuration(session) : null;
  }

  getAllStatuses(): RecordingSession[] {
    return [...this.sessions.values()].map(
      (session) => this.withDuration(session)
    );
  }
}
