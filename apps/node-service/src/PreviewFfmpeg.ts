
export function buildPreviewFfmpegArgs(
  cameraDeviceId: string
): string[] {
  return [
    "-hide_banner",
    "-loglevel", "error",

    "-f", "dshow",
    "-rtbufsize", "256M",
    "-vcodec", "mjpeg",
    "-video_size", "1280x720",
    "-framerate", "30",
    "-i", `video=${cameraDeviceId}`,

    "-an",
    "-vf", "fps=5,scale=640:360",
    "-c:v", "mjpeg",
    "-q:v", "5",

    "-f", "image2pipe",
    "pipe:1"
  ];
}
