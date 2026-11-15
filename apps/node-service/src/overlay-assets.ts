import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const folder = path.resolve(process.env.TOURNAMENT_CONFIG_DIR || path.join(process.cwd(), "config"), "overlays");
export function overlayFile(imageId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}\.(png|jpg)$/i.test(imageId)) throw new Error("Invalid overlay image ID");
  return path.join(folder, imageId);
}
export function saveOverlayImage(base64: unknown): string {
  if (typeof base64 !== "string" || base64.length > 7_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("Invalid overlay image");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error("Overlay image must be 5 MB or smaller");
  const png = bytes.length > 8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpg) throw new Error("Only PNG and JPEG images are supported");
  const imageId = `${randomUUID()}.${png ? "png" : "jpg"}`;
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(overlayFile(imageId), bytes, { flag: "wx" });
  return imageId;
}
export function getOverlayImage(imageId: string): Buffer { return fs.readFileSync(overlayFile(imageId)); }
export function resolveOverlayImage(imageId: string): string {
  const file = overlayFile(imageId);
  if (!fs.existsSync(file)) throw new Error(`Overlay image ${imageId} is missing on this node. Upload it to this node before recording.`);
  return file;
}
