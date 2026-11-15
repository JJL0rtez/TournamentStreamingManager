
import { discoverDevices } from "./device-discovery.js";
import { probeCameraCapabilities } from "./camera-capabilities.js";

async function main() {
  console.log("");
  console.log("==================================");
  console.log(" Tournament Streaming");
  console.log(" Windows Device Discovery");
  console.log("==================================");
  console.log("");

  try {
    const devices = await discoverDevices();

    const cameras = devices.filter(
      (device) => device.kind === "video"
    );

    const microphones = devices.filter(
      (device) => device.kind === "audio"
    );

    console.log(`Found ${cameras.length} video devices.`);
    console.log(`Found ${microphones.length} audio devices.`);
    console.log("");

    for (const camera of cameras) {
      console.log(`[CAMERA] ${camera.name}`);
      console.log(`  Classification: ${camera.classification}`);
      console.log(`  ID: ${camera.id}`);
      console.log("");
    }

    for (const microphone of microphones) {
      console.log(`[AUDIO] ${microphone.name}`);
      console.log(`  Classification: ${microphone.classification}`);
      console.log(`  ID: ${microphone.id}`);
      console.log("");
    }

    console.log("==================================");
    console.log(" Camera Capture Capabilities");
    console.log("==================================");
    console.log("");

    const physicalCameras = cameras.filter(
      (camera) => camera.classification === "physical"
    );

    for (const camera of physicalCameras) {
      console.log(`Checking ${camera.name}...`);

      try {
        const capabilities = await probeCameraCapabilities(
          camera.name
        );

        if (capabilities.modes.length === 0) {
          console.log("  No capture modes parsed.");
          console.log("");
          continue;
        }

        for (const mode of capabilities.modes) {
          console.log(
            `  ${mode.width}x${mode.height} | ` +
            `${mode.fps} FPS | Pixel format: ${mode.pixelFormat}`
          );
        }

        console.log("");
      } catch (error) {
        console.error(
          `Unable to query ${camera.name}:`,
          error
        );
      }
    }

    console.log("Discovery complete.");
  } catch (error) {
    console.error("Device discovery failed:");

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exitCode = 1;
  }
}

main();
