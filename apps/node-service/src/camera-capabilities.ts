import { spawn } from "node:child_process";

export interface CameraMode { width: number; height: number; fps: number; pixelFormat: string }
export interface CameraCapabilities {
  cameraName: string;
  modes: CameraMode[];
  detected: boolean;
  error?: string;
}

/** Query DirectShow without starting a recording. FFmpeg lists modes on stderr. */
export async function probeCameraCapabilities(cameraName: string): Promise<CameraCapabilities> {
  if (process.platform !== "win32") return { cameraName, modes: [], detected: false, error: "DirectShow probing requires Windows." };
  return new Promise(resolve => {
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
      "-hide_banner", "-list_options", "true", "-f", "dshow", "-i", `video=${cameraName}`
    ], { windowsHide: true });
    let stderr = "";
    let settled = false;
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const modes: CameraMode[] = [];
      // Example: vcodec=mjpeg min s=1920x1080 fps=30 max s=1920x1080 fps=60
      for (const line of stderr.split(/\r?\n/)) {
        const format = /(?:vcodec|pixel_format)\s*=\s*([\w]+)/i.exec(line)?.[1] || "unknown";
        if (!/mjpeg|mjpg/i.test(format)) continue;
        const matches = [...line.matchAll(/\bs=(\d+)x(\d+)\s+fps=([\d.]+)/g)];
        for (const match of matches) {
          const width = Number(match[1]), height = Number(match[2]), fps = Number(match[3]);
          if (width > 0 && height > 0 && fps > 0 && fps <= 240 &&
              !modes.some(m => m.width === width && m.height === height && m.fps === fps)) {
            modes.push({ width, height, fps, pixelFormat: format });
          }
        }
      }
      resolve({ cameraName, modes: modes.sort((a,b) => b.width*b.height - a.width*a.height || b.fps-a.fps),
        detected: modes.length > 0, ...(modes.length ? {} : { error: error || "No MJPEG modes reported by DirectShow." }) });
    };
    const timer = setTimeout(() => { child.kill(); finish("Camera capability probe timed out after 8 seconds."); }, 8000);
    child.stderr.on("data", chunk => { if (stderr.length < 200000) stderr += chunk.toString(); });
    child.on("error", error => finish(error.message));
    child.on("close", () => finish());
  });
}

export function selectCameraMode(modes: CameraMode[], requestedFps: number): CameraMode | null {
  const hd = modes.filter(m => m.width === 1920 && m.height === 1080 && m.fps <= requestedFps + 0.01);
  return hd.sort((a,b) => b.fps-a.fps)[0] || null;
}
