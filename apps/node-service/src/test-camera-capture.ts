
import { CameraCapture } from "./camera-capture.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const capture = new CameraCapture();

async function main() {
  console.log("Starting shared camera capture...");

  const recordingPath = await capture.start({
    cameraName: "EMEET SmartCam S600",
    microphoneName: "Microphone (EMEET SmartCam S600)",
    outputDirectory: path.resolve("recordings")
  });

  console.log("Recording path:", recordingPath);

console.log("Capture running:", capture.isRunning);

console.log("Waiting for first camera frame...");
await capture.waitUntilReady();
console.log("Camera capture ready.");

  let frameSaved = false;

  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const frame = capture.getFrame();

    if (frame) {
      await writeFile("shared-preview-test.jpg", frame);
      console.log("Preview frame saved: shared-preview-test.jpg");
      frameSaved = true;
      break;
    }
  }

  if (!frameSaved) {
    console.error("No preview frame received within 10 seconds.");
  }

  console.log("Recording for another 5 seconds...");

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log("Stopping shared capture...");
  capture.stop();
}

main().catch((error) => {
  console.error(error);
  capture.stop();
  process.exitCode = 1;
});
