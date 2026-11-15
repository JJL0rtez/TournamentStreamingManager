import { getCameraQuality } from "./camera-quality-settings.js";

export interface UsbBandwidthEstimate {
  cameraId: string;
  cameraName: string;
  width: number;
  height: number;
  fps: number;
  // These are hypothetical USB payload rates, NOT measured usage.
  mjpegLowMbps: number;
  mjpegHighMbps: number;
  uncompressedYuy2Mbps: number;
}

// MJPEG sizes vary drastically with motion, scene complexity and camera firmware.
// 0.08-0.30 bytes/pixel is a planning range, not a device specification.
const MJPEG_BYTES_PER_PIXEL_LOW = 0.08;
const MJPEG_BYTES_PER_PIXEL_HIGH = 0.30;
const YUY2_BYTES_PER_PIXEL = 2;
const mbps = (width: number, height: number, fps: number, bpp: number) =>
  Math.round(width * height * fps * bpp * 8 / 1_000_000 * 10) / 10;

export function estimateUsbBandwidth(cameras: Array<{ id: string; name: string }>) {
  const estimates: UsbBandwidthEstimate[] = cameras.map(camera => {
    const { width, height, fps } = getCameraQuality(camera.id);
    return {
      cameraId: camera.id, cameraName: camera.name, width, height, fps,
      mjpegLowMbps: mbps(width, height, fps, MJPEG_BYTES_PER_PIXEL_LOW),
      mjpegHighMbps: mbps(width, height, fps, MJPEG_BYTES_PER_PIXEL_HIGH),
      uncompressedYuy2Mbps: mbps(width, height, fps, YUY2_BYTES_PER_PIXEL)
    };
  });
  const total = (key: "mjpegLowMbps" | "mjpegHighMbps" | "uncompressedYuy2Mbps") =>
    Math.round(estimates.reduce((sum, camera) => sum + camera[key], 0) * 10) / 10;
  return {
    checkedAt: new Date().toISOString(),
    assumptions: {
      mjpegBytesPerPixelRange: [MJPEG_BYTES_PER_PIXEL_LOW, MJPEG_BYTES_PER_PIXEL_HIGH],
      yuy2BytesPerPixel: YUY2_BYTES_PER_PIXEL,
      note: "Estimates only. Actual USB transfer format, compression, controller topology and negotiated speed are not detected. H.264 recording and YouTube bitrates are downstream of USB and must not be used as USB bandwidth estimates."
    },
    cameras: estimates,
    totals: {
      mjpegLowMbps: total("mjpegLowMbps"),
      mjpegHighMbps: total("mjpegHighMbps"),
      uncompressedYuy2Mbps: total("uncompressedYuy2Mbps")
    }
  };
}
