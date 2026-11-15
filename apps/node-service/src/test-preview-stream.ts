
import { writeFileSync } from "node:fs";
import { PreviewStream } from "./preview-stream.js";

const preview = new PreviewStream();

console.log("Starting persistent camera preview...");

preview.start("EMEET SmartCam S600");

let attempts = 0;

const timer = setInterval(() => {
  attempts++;

  const frame = preview.getFrame();

  if (frame) {
    writeFileSync("preview-stream-test.jpg", frame);

    console.log(`Captured JPEG frame (${frame.length} bytes)`);

    clearInterval(timer);
    preview.stop();
    return;
  }

  console.log(`Waiting for frame... ${attempts}`);

  if (attempts >= 20) {
    console.error("No preview frame received after 10 seconds.");

    clearInterval(timer);
    preview.stop();
    process.exitCode = 1;
  }
}, 500);
