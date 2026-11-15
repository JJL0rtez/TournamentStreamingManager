import { getSettings } from "./persistent-settings.js";
import type { Express, Request, Response, NextFunction } from "express";

interface Peer { id: string; name: string; url: string; token: string }
const nodeId = process.env.NODE_ID || "local";
const nodeName = process.env.NODE_NAME || "Primary PC";
const nodeToken = process.env.NODE_TOKEN || "";
const isRemote = process.env.NODE_ROLE === "remote";
const idPattern = /^[a-zA-Z0-9_-]{1,40}$/;

function peers(): Peer[] {
  if (isRemote) return [];
  const raw = process.env.NODE_PEERS;
  if (!raw) return [];
  const input: unknown = JSON.parse(raw);
  if (!Array.isArray(input)) throw new Error("NODE_PEERS must be a JSON array");
  return input.map((value: any) => {
    if (!value || !idPattern.test(value.id) || typeof value.name !== "string" ||
        typeof value.token !== "string" || value.token.length < 24 ||
        typeof value.url !== "string") throw new Error("Invalid NODE_PEERS entry");
    const url = new URL(value.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Invalid peer protocol");
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      throw new Error("Peer URL must be an origin, e.g. http://192.168.1.25:3001");
    return { id: value.id, name: value.name, token: value.token, url: url.origin };
  });
}

// Only these exact API paths can be forwarded to another node.
const allowed = [
  /^\/api\/health$/,
  /^\/api\/session$/,
  /^\/api\/session\/(start-all|stop-all)$/,
  /^\/api\/devices$/,
  /^\/api\/captures$/,
  /^\/api\/captures\/start$/,
  /^\/api\/captures\/stop-all$/,
  /^\/api\/captures\/[^/]+\/(stop|frame)$/,
  /^\/api\/previews$/,
  /^\/api\/previews\/start$/,
  /^\/api\/previews\/[^/]+\/(stop|frame)$/,
  /^\/api\/youtube\/streams$/,
  /^\/api\/youtube\/[^/]+\/(start|stop)$/
];

export function installRemoteNodeRoutes(app: Express) {
  const configuredPeers = getSettings().network.mode === "offline" ? [] : peers();
  if (isRemote && nodeToken.length < 24) throw new Error("Remote nodes require NODE_TOKEN (24+ characters)");

  // On a remote node all API calls, including status and frames, require the shared secret.
  // Install BEFORE all other /api routes.
  if (isRemote) {
    app.use("/api", (req: Request, res: Response, next: NextFunction) => {
      if (req.get("x-tournament-node-token") !== nodeToken) {
        res.status(401).json({ error: "Unauthorized node request" });
        return;
      }
      next();
    });
  }

  app.get("/api/nodes", async (_req, res) => {
    const statuses = await Promise.all(configuredPeers.map(async (peer) => {
      try {
        const response = await fetch(`${peer.url}/api/health`, {
          headers: { "x-tournament-node-token": peer.token },
          signal: AbortSignal.timeout(2500)
        });
        return { id: peer.id, name: peer.name, online: response.ok, local: false };
      } catch { return { id: peer.id, name: peer.name, online: false, local: false }; }
    }));
    res.setHeader("Cache-Control", "no-store");
    res.json({ nodes: [{ id: nodeId, name: nodeName, online: true, local: true }, ...statuses] });
  });

  // Route to a configured origin only, never a URL provided by the browser.
  app.use("/api/nodes/:nodeId", async (req, res) => {
    const peer = configuredPeers.find((item) => item.id === req.params.nodeId);
    if (!peer) { res.status(404).json({ error: "Unknown node" }); return; }
    const targetPath = `/api${req.path}`;
    if (!allowed.some((pattern) => pattern.test(targetPath)) || !["GET", "POST", "PUT"].includes(req.method)) {
      res.status(404).json({ error: "Unsupported node operation" }); return;
    }
    // Do not permit a GET to invoke a mutating endpoint or vice versa.
    const readOnly = targetPath === "/api/session" ? req.method === "GET" : targetPath === "/api/health" || targetPath === "/api/devices" ||
      targetPath === "/api/captures" || targetPath === "/api/previews" ||
      targetPath === "/api/youtube/streams" || targetPath.endsWith("/frame");
    if ((readOnly && req.method !== "GET") ||
        (!readOnly && req.method !== (targetPath === "/api/session" ? "PUT" : "POST"))) {
      res.status(405).json({ error: "Method not allowed" }); return;
    }
    try {
      const upstream = await fetch(`${peer.url}${targetPath}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`, {
        method: req.method,
        headers: {
          "x-tournament-node-token": peer.token,
          ...(["POST", "PUT"].includes(req.method) ? { "content-type": "application/json" } : {})
        },
        body: ["POST", "PUT"].includes(req.method) ? JSON.stringify(req.body ?? {}) : undefined,
        signal: AbortSignal.timeout(targetPath.endsWith("start-all") || targetPath.endsWith("stop-all") ? 180000 : targetPath.endsWith("/start") || targetPath.endsWith("/stop") ? 30000 : 6000)
      });
      res.status(upstream.status);
      res.setHeader("Cache-Control", "no-store");
      const type = upstream.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", type);
      const bytes = Buffer.from(await upstream.arrayBuffer());
      res.send(bytes);
    } catch {
      res.status(502).json({ error: `Node ${peer.name} unavailable or timed out` });
    }
  });
}
