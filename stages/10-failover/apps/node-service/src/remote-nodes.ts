import { PeerTransport, normalizeEndpoints, type Endpoint } from "./peer-transport.js";
import { summarizeFleet, selectNodeStatus, type FleetNodeSnapshot } from "./fleet-readiness.js";
import { getSettings } from "./persistent-settings.js";
import type { Express, Request, Response, NextFunction } from "express";

interface Peer { id: string; name: string; url: string; token: string; endpoints: Endpoint[] }
const peerTransport = new PeerTransport();
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
    const endpoints=normalizeEndpoints(url.origin, value.lanUrl, value.tailscaleUrl);
    return { id: value.id, name: value.name, token: value.token, url: url.origin, endpoints };
  });
}

// Only these exact API paths can be forwarded to another node.
export const allowedRemoteNodeRoutes = [
  /^\/api\/health$/,
  /^\/api\/captures\/health$/,
  /^\/api\/storage\/health$/,
  /^\/api\/storage\/readiness$/,
  /^\/api\/storage\/benchmark$/,
  /^\/api\/usb\/topology$/,
  /^\/api\/usb\/topology\/changes$/,
  /^\/api\/entitlement\/status$/,
  /^\/api\/output-mode\/readiness$/,
  /^\/api\/output-inventory$/,
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
        const {response} = await peerTransport.request(peer.id,peer.endpoints,"/api/health",peer.token);
        return { id: peer.id, name: peer.name, online: response.ok, local: false };
      } catch { return { id: peer.id, name: peer.name, online: false, local: false }; }
    }));
    res.setHeader("Cache-Control", "no-store");
    res.json({ nodes: [{ id: nodeId, name: nodeName, online: true, local: true }, ...statuses] });
  });

  // Fleet health is read-only and bounded. A peer outage never stops local capture.
  app.get("/api/nodes/fleet-readiness", async (_req, res) => {
    const all = [{id:nodeId,name:nodeName,url:"",token:"",local:true},
      ...configuredPeers.map(p=>({...p,local:false}))];
    const results: FleetNodeSnapshot[] = await Promise.all(all.map(async node => {
      const started=Date.now();
      const errors:string[]=[];
      const read = async (route:string):Promise<unknown|null> => {
        try {
          if(node.local)return null;
          const endpointPeer=configuredPeers.find(p=>p.id===node.id);
          if(!endpointPeer)throw new Error("Unknown peer");
          const {response}=await peerTransport.request(node.id,endpointPeer.endpoints,route,node.token);
          if(!response.ok){errors.push(`${route}: HTTP ${response.status}`);return null;}
          const contentLength=Number(response.headers.get("content-length")??"0");
          if(contentLength>262144){errors.push(`${route}: oversized response`);return null;}
          const text=await response.text();
          if(text.length>262144){errors.push(`${route}: oversized response`);return null;}
          return selectNodeStatus(JSON.parse(text));
        }catch(error){errors.push(`${route}: ${error instanceof Error?error.message:String(error)}`);return null;}
      };
      if(node.local){
        // Do not self-fetch through a potentially public bind address.
        return {id:node.id,name:node.name,local:true,online:true,checkedAt:new Date().toISOString(),
          latencyMs:0,health:{local:true},storage:null,captures:null,entitlement:null,
          errors:["Local details available from this node's own health and storage endpoints"]};
      }
      const health=await read("/api/health");
      if(!health)return {id:node.id,name:node.name,local:false,online:false,
        checkedAt:new Date().toISOString(),latencyMs:Date.now()-started,health:null,
        storage:null,captures:null,entitlement:null,errors};
      const [storage,captures,entitlement]=await Promise.all([
        read("/api/storage/health"),read("/api/captures/health"),read("/api/entitlement/status")
      ]);
      return {id:node.id,name:node.name,local:false,online:true,
        checkedAt:new Date().toISOString(),latencyMs:Date.now()-started,
        health,storage,captures,entitlement,errors};
    }));
    res.setHeader("Cache-Control","no-store");
    res.json(summarizeFleet(results));
  });

  app.get("/api/nodes/transports",(_req,res)=>{
    res.setHeader("Cache-Control","no-store");
    res.json({nodes:configuredPeers.map(peer=>({id:peer.id,name:peer.name,
      endpoints:peer.endpoints.map(e=>({kind:e.kind,url:e.url})),
      ...peerTransport.report(peer.id)}))});
  });

  // Route to a configured origin only, never a URL provided by the browser.
  app.use("/api/nodes/:nodeId", async (req, res) => {
    const peer = configuredPeers.find((item) => item.id === req.params.nodeId);
    if (!peer) { res.status(404).json({ error: "Unknown node" }); return; }
    const targetPath = `/api${req.path}`;
    if (req.url.length > 4096) { res.status(414).json({error:"Node query too long"}); return; }
    if (!allowedRemoteNodeRoutes.some((pattern) => pattern.test(targetPath)) || !["GET", "POST", "PUT"].includes(req.method)) {
      res.status(404).json({ error: "Unsupported node operation" }); return;
    }
    // Do not permit a GET to invoke a mutating endpoint or vice versa.
    const readOnly = targetPath === "/api/session" ? req.method === "GET" : targetPath === "/api/health" || targetPath === "/api/captures/health" ||
      targetPath === "/api/storage/health" || targetPath === "/api/storage/readiness" ||
      targetPath === "/api/storage/benchmark" || targetPath === "/api/usb/topology" ||
      targetPath === "/api/usb/topology/changes" || targetPath === "/api/entitlement/status" ||
      targetPath === "/api/output-mode/readiness" || targetPath === "/api/output-inventory" || targetPath === "/api/devices" ||
      targetPath === "/api/captures" || targetPath === "/api/previews" ||
      targetPath === "/api/youtube/streams" || targetPath.endsWith("/frame");
    if ((readOnly && req.method !== "GET") ||
        (!readOnly && req.method !== (targetPath === "/api/session" ? "PUT" : "POST"))) {
      res.status(405).json({ error: "Method not allowed" }); return;
    }
    try {
      const {response:upstream}=await peerTransport.request(peer.id,peer.endpoints,
        `${targetPath}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`,
        peer.token,{
          method:req.method as "GET"|"POST"|"PUT",
          body:["POST","PUT"].includes(req.method)?JSON.stringify(req.body??{}):undefined,
          timeoutMs:targetPath.endsWith("start-all") || targetPath.endsWith("stop-all") ? 180000 : targetPath.endsWith("/start") || targetPath.endsWith("/stop") ? 30000 : 6000
        });
      res.status(upstream.status);
      res.setHeader("Cache-Control", "no-store");
      const type = upstream.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", type);
      const declaredSize = Number(upstream.headers.get("content-length") || "0");
      if (declaredSize > 2 * 1024 * 1024 && !targetPath.endsWith("/frame")) {
        res.status(502).json({error:"Upstream response too large"}); return;
      }
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (bytes.length > 2 * 1024 * 1024 && !targetPath.endsWith("/frame")) {
        res.status(502).json({error:"Upstream response too large"}); return;
      }
      res.send(bytes);
    } catch {
      res.status(502).json({ error: `Node ${peer.name} unavailable or timed out` });
    }
  });
}
