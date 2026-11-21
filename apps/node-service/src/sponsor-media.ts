import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

export const MAX_SPONSOR_BYTES = 200 * 1024 * 1024;
const assetPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(mp4|webm)$/;
export function sponsorVideoType(header: Buffer): "mp4" | "webm" | null {
  if (header.length >= 12 && header.toString("ascii", 4, 8) === "ftyp") return "mp4";
  if (header.length >= 4 && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "webm";
  return null;
}
/** Store uploaded media on the node so every display can play it after refresh. */
export function installSponsorMedia(app: Express, directory = path.resolve(process.cwd(), "data", "sponsor-media")) {
  let uploading = false;
  app.post("/api/tournament-displays/media", async (req, res) => {
    const mime = req.get("content-type");
    if (mime !== "video/mp4" && mime !== "video/webm") { res.status(415).json({error:"Choose an MP4 or WebM video."}); return; }
    const length = Number(req.get("content-length"));
    if (!Number.isSafeInteger(length) || length < 12 || length > MAX_SPONSOR_BYTES) { res.status(413).json({error:"Video must be between 12 bytes and 200 MB."}); return; }
    if (uploading) { res.status(409).json({error:"Another video upload is in progress."}); return; }
    uploading = true;
    const id = randomUUID(); const temporary = path.join(directory, `${id}.part`);
    try {
      await mkdir(directory,{recursive:true});
      let count = 0;
      const limiter = new Transform({transform(chunk:Buffer,_encoding,callback){count += chunk.length; if(count > length || count > MAX_SPONSOR_BYTES) callback(new Error("Video exceeds upload limit")); else callback(null,chunk);}});
      await pipeline(req, limiter, createWriteStream(temporary,{flags:"wx"}));
      if(count !== length) throw new Error("Incomplete video upload");
      const handle = await open(temporary,"r"); const header = Buffer.alloc(12);
      try { await handle.read(header,0,header.length,0); } finally { await handle.close(); }
      const type = sponsorVideoType(header);
      if (!type || mime !== `video/${type}`) { res.status(415).json({error:"The file is not the selected video format."}); return; }
      const name = `${id}.${type}`;
      await rename(temporary,path.join(directory,name));
      res.status(201).json({url:`/api/tournament-displays/media/${name}`});
    } catch { if (!res.headersSent && !res.destroyed) res.status(400).json({error:"Video could not be stored. Check the file and available disk space."}); }
    finally { await unlink(temporary).catch(()=>{}); uploading = false; }
  });
  app.get("/api/tournament-displays/media/:name", (req,res) => {
    const name = req.params.name;
    if(!assetPattern.test(name)){res.sendStatus(404);return;}
    res.setHeader("X-Content-Type-Options","nosniff");
    res.sendFile(name,{root:directory,acceptRanges:true,maxAge:3600000},error=>{if(error && !res.headersSent)res.sendStatus(404);});
  });
}
