/** Stable local UDP port per DirectShow device. A hash collision is possible. */
export function streamPort(cameraId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < cameraId.length; i++) {
    hash ^= cameraId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 20000 + (hash >>> 0) % 30000;
}
