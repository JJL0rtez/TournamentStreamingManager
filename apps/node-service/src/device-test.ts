import { spawn } from "node:child_process";

export type AudioTestResult = {
  status: "signal" | "silent" | "busy" | "error";
  meanDb: number | null;
  maxDb: number | null;
  message: string;
};

/** Read a short audio sample without saving or transmitting audio. */
export async function testMicrophoneLevel(microphoneName: string, seconds = 3): Promise<AudioTestResult> {
  const duration = Math.max(1, Math.min(5, seconds));
  return new Promise((resolve) => {
    const ffmpeg = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
      "-hide_banner", "-nostdin", "-loglevel", "info", "-f", "dshow",
      "-i", `audio=${microphoneName}`, "-t", String(duration),
      "-af", "volumedetect", "-vn", "-f", "null", "-"
    ], { windowsHide: true });
    let output = "";
    let finished = false;
    const finish = (result: AudioTestResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      ffmpeg.kill();
      finish({ status: "error", meanDb: null, maxDb: null, message: "Audio test timed out." });
    }, (duration + 8) * 1000);
    ffmpeg.stderr.on("data", (data: Buffer) => {
      output = (output + data.toString()).slice(-24000);
    });
    ffmpeg.on("error", (error) => finish({
      status: "error", meanDb: null, maxDb: null, message: `FFmpeg could not start: ${error.message}`
    }));
    ffmpeg.on("close", (code) => {
      if (finished) return;
      const meanMatch = output.match(/mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/i);
      const maxMatch = output.match(/max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/i);
      const meanDb = meanMatch ? Number(meanMatch[1]) : null;
      const maxDb = maxMatch ? Number(maxMatch[1]) : null;
      if (code !== 0 || maxDb === null) {
        finish({ status: "error", meanDb, maxDb,
          message: "Could not measure microphone level. Check microphone permissions, availability and FFmpeg." });
        return;
      }
      // A near-silent input is not proof of a failed mic. Ask the operator to speak.
      const signal = Number.isFinite(maxDb) && maxDb > -45;
      finish({ status: signal ? "signal" : "silent", meanDb, maxDb,
        message: signal ? "Audio signal detected." : "No clear signal detected. Speak into the microphone and test again." });
    });
  });
}
