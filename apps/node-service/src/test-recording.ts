
import path from "node:path";
import { Recorder } from "./recorder.js";

async function main() {
  const recorder = new Recorder();

  const outputDirectory = path.resolve(
    process.cwd(),
    "../../recordings"
  );

  console.log("Starting recording...");

  const file = await recorder.start({
    cameraName: "EMEET SmartCam S600",
    microphoneName: "Microphone (EMEET SmartCam S600)",
    outputDirectory,
    width: 1920,
    height: 1080,
    fps: 30
  });

  console.log(`Recording to: ${file}`);
  console.log("Press Enter to stop recording.");

  process.stdin.resume();

process.stdin.once("data", async () => {
  console.log("Stopping recording...");

  try {
    await recorder.stop();
    console.log("Recording stopped successfully.");
  } catch (error) {
    console.error("Failed to stop recording:", error);
  } finally {
    process.stdin.pause();
  }
});

}

main().catch(console.error);
