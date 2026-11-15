
import { spawn } from "node:child_process";
import type {
  DirectShowDevice,
  DeviceKind,
  DeviceClassification
} from "@tournament/shared";

const DEVICE_PATTERN = /"(.+)" \((video|audio|none)\)\s*$/;
const ALTERNATIVE_PATTERN = /Alternative name "(.+)"\s*$/;

function classifyDevice(
  kind: DeviceKind,
  alternativeName?: string
): DeviceClassification {
  if (alternativeName?.startsWith("@device_sw_")) {
    return "virtual";
  }

  if (alternativeName?.startsWith("@device_pnp_")) {
    return "physical";
  }

  return "unknown";
}

export function parseDirectShowDevices(
  output: string
): DirectShowDevice[] {
  const devices: DirectShowDevice[] = [];

  let currentDevice: {
    name: string;
    kind: DeviceKind;
    alternativeName?: string;
  } | null = null;

  function saveCurrentDevice() {
    if (!currentDevice) return;

    const classification = classifyDevice(
      currentDevice.kind,
      currentDevice.alternativeName
    );

    devices.push({
      id:
        currentDevice.alternativeName ??
        `${currentDevice.kind}:${currentDevice.name}`,
      name: currentDevice.name,
      kind: currentDevice.kind,
      classification,
      alternativeName: currentDevice.alternativeName
    });

    currentDevice = null;
  }

  for (const line of output.split(/\r?\n/)) {
    const deviceMatch = line.match(DEVICE_PATTERN);

    if (deviceMatch) {
      saveCurrentDevice();

      currentDevice = {
        name: deviceMatch[1],
        kind: deviceMatch[2] as DeviceKind
      };

      continue;
    }

    const alternativeMatch = line.match(ALTERNATIVE_PATTERN);

    if (alternativeMatch && currentDevice) {
      currentDevice.alternativeName = alternativeMatch[1];
    }
  }

  saveCurrentDevice();

  return devices;
}

export async function discoverDevices(): Promise<DirectShowDevice[]> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";

    const ffmpegProcess = spawn(
      ffmpegPath,
      [
        "-hide_banner",
        "-list_devices",
        "true",
        "-f",
        "dshow",
        "-i",
        "dummy"
      ],
      {
        windowsHide: true
      }
    );

    let output = "";

    const timeout = setTimeout(() => {
      ffmpegProcess.kill();
      reject(new Error("FFmpeg device discovery timed out."));
    }, 15000);

    ffmpegProcess.stderr.setEncoding("utf8");

    ffmpegProcess.stderr.on("data", (chunk: string) => {
      output += chunk;
    });

    ffmpegProcess.on("error", (error) => {
      clearTimeout(timeout);

      reject(
        new Error(
          `Unable to start FFmpeg: ${error.message}`
        )
      );
    });

    ffmpegProcess.on("close", () => {
      clearTimeout(timeout);

      // FFmpeg normally exits with an error after listing devices.
      // This is expected because "dummy" is not a real capture device.

      const devices = parseDirectShowDevices(output);

      resolve(devices);
    });
  });
}
