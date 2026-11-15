
import { writeFileSync } from "node:fs";
import { capturePreviewFrame } from "./preview-capture.js";

async function main() {
  try {
    console.log("Capturing preview frame...");

    const frame = await capturePreviewFrame("EMEET SmartCam S600");

    writeFileSync("preview-test.jpg", frame);

    console.log(`Saved preview-test.jpg (${frame.length} bytes)`);
  } catch (error) {
    console.error("Preview capture failed:", error);
    process.exitCode = 1;
  }
}

void main();
