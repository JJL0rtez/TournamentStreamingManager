/** Read-only YouTube platform status. Never return credentials or ingest URLs. */
export type PlatformCamera = {
  cameraId: string;
  broadcast: "live" | "testing" | "upcoming" | "complete" | "other" | "unknown";
  ingest: "active" | "inactive" | "ready" | "error" | "unknown";
  health: "good" | "ok" | "bad" | "noData" | "unknown";
  issues: string[];
};
export type PlatformSnapshot = {
  enabled: boolean; checkedAt: string | null; stale: boolean;
  cameras: PlatformCamera[]; status: "healthy" | "warning" | "unknown";
  message: string;
};
type Mapping = {cameraId: string; broadcastId: string};
type Fetcher = typeof fetch;
const MAX_CAMERAS = 8;
const CACHE_MS = 60000;
const TIMEOUT_MS = 8000;
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;

/** Configuration is an environment JSON array, not a browser-editable endpoint. */
export function parseBroadcastMap(raw: string | undefined): Mapping[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Invalid YouTube broadcast mapping JSON"); }
  if (!Array.isArray(value) || value.length > MAX_CAMERAS) throw new Error("YouTube mapping requires at most eight cameras");
  const seen = new Set<string>();
  const mappings: Mapping[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") throw new Error("Invalid YouTube mapping entry");
    const {cameraId, broadcastId} = entry as Record<string, unknown>;
    if (typeof cameraId !== "string" || typeof broadcastId !== "string" || !idPattern.test(cameraId) || !idPattern.test(broadcastId) || seen.has(cameraId))
      throw new Error("Invalid or duplicate YouTube camera/broadcast ID");
    seen.add(cameraId);
    mappings.push({cameraId,broadcastId});
  }
  return mappings;
}

const unverified = (cameraId: string, issue: string): PlatformCamera => ({cameraId,broadcast:"unknown",ingest:"unknown",health:"unknown",issues:[issue]});
function lifecycle(value: unknown): PlatformCamera["broadcast"] {
  if (value === "live" || value === "testing" || value === "upcoming" || value === "complete") return value;
  return typeof value === "string" ? "other" : "unknown";
}
function ingestState(value: unknown): PlatformCamera["ingest"] {
  return value === "active" || value === "inactive" || value === "ready" || value === "error" ? value : "unknown";
}
function healthState(value: unknown): PlatformCamera["health"] {
  return value === "good" || value === "ok" || value === "bad" || value === "noData" ? value : "unknown";
}
function issuesFor(camera: PlatformCamera): string[] {
  const problems: string[] = [];
  if (camera.broadcast !== "live") problems.push(`Broadcast lifecycle: ${camera.broadcast}`);
  if (camera.ingest !== "active") problems.push(`Ingest stream: ${camera.ingest}`);
  if (camera.health !== "good" && camera.health !== "ok") problems.push(`YouTube ingest health: ${camera.health}`);
  return problems;
}

/** Each request has a fixed Google origin, timeout, and bounded response size. */
async function googleList(endpoint: "liveBroadcasts" | "liveStreams", ids: string[], part: string, token: string, request: Fetcher) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.searchParams.set("part", part);
  url.searchParams.set("id", ids.join(","));
  const response = await request(url, {method:"GET",headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},signal:AbortSignal.timeout(TIMEOUT_MS),redirect:"error"});
  if (!response.ok) throw new Error(`YouTube API HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > 262144) throw new Error("YouTube API response too large");
  const body = await response.text();
  if (body.length > 262144) throw new Error("YouTube API response too large");
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as {items?:unknown}).items)) throw new Error("Malformed YouTube API response");
  return (parsed as {items:Record<string,any>[]}).items;
}

export async function queryPlatformHealth(mappings: Mapping[], token: string, request: Fetcher = fetch): Promise<PlatformSnapshot> {
  const checkedAt = new Date().toISOString();
  if (!mappings.length) return {enabled:false,checkedAt:null,stale:true,cameras:[],status:"unknown",message:"No YouTube broadcast mappings configured"};
  if (!token || token.length < 16) return {enabled:true,checkedAt:null,stale:true,cameras:mappings.map(m=>unverified(m.cameraId,"OAuth access token unavailable")),status:"unknown",message:"YouTube OAuth access token unavailable"};
  try {
    const broadcasts = await googleList("liveBroadcasts", mappings.map(m=>m.broadcastId), "id,status,contentDetails", token, request);
    const byId = new Map(broadcasts.filter(b=>typeof b.id === "string").map(b=>[b.id,b]));
    const streamIds = [...new Set(broadcasts.map(b=>b.contentDetails?.boundStreamId).filter((id):id is string=>typeof id === "string" && idPattern.test(id)))];
    const streams = streamIds.length ? await googleList("liveStreams",streamIds,"id,status",token,request) : [];
    const byStream = new Map(streams.filter(s=>typeof s.id === "string").map(s=>[s.id,s]));
    const cameras = mappings.map(mapping=>{
      const b = byId.get(mapping.broadcastId);
      if (!b) return unverified(mapping.cameraId,"Broadcast ID not found or not accessible");
      const boundId = b.contentDetails?.boundStreamId;
      const s = typeof boundId === "string" ? byStream.get(boundId) : undefined;
      const camera:PlatformCamera = {cameraId:mapping.cameraId,broadcast:lifecycle(b.status?.lifeCycleStatus),ingest:ingestState(s?.status?.streamStatus),health:healthState(s?.status?.healthStatus?.status),issues:[]};
      camera.issues = issuesFor(camera);
      return camera;
    });
    const status = cameras.some(c=>c.broadcast === "unknown" || c.ingest === "unknown" || c.health === "unknown" || c.health === "noData") ? "unknown" : cameras.every(c=>c.issues.length===0) ? "healthy" : "warning";
    return {enabled:true,checkedAt,stale:false,cameras,status,message:"YouTube API metadata only. This does not verify viewer playback, video motion, or audio."};
  } catch (error) {
    // Never propagate an error body, token or URL into dashboard telemetry.
    const message = error instanceof Error && /^YouTube API HTTP \d{3}$/.test(error.message) ? error.message : "YouTube API request failed";
    return {enabled:true,checkedAt,stale:true,cameras:mappings.map(m=>unverified(m.cameraId,message)),status:"unknown",message};
  }
}

/** One request per interval across all dashboard clients. No background polling. */
export function createPlatformHealthReader(config: () => {mapping:string|undefined;token:string|undefined}, request:Fetcher=fetch, now:()=>number=Date.now) {
  let until = 0;
  let previousKey = "";
  let previousToken = "";
  let last: PlatformSnapshot | null = null;
  let pending: Promise<PlatformSnapshot> | null = null;
  return async (): Promise<PlatformSnapshot> => {
    const {mapping,token} = config();
    let mappings:Mapping[];
    try { mappings = parseBroadcastMap(mapping); }
    catch { return {enabled:false,checkedAt:null,stale:true,cameras:[],status:"unknown",message:"Invalid YouTube broadcast configuration"}; }
    // Do not store or expose a token-derived key. Config is normally static for a process.
    const key = mapping ?? "";
    if (key !== previousKey || (token ?? "") !== previousToken) { last=null; until=0; previousKey=key; previousToken=token ?? ""; }
    if (last && now() < until) return last;
    if (pending) return pending;
    pending = queryPlatformHealth(mappings,token ?? "",request).then(value=>{last=value;until=now()+CACHE_MS;return value;}).finally(()=>{pending=null;});
    return pending;
  };
}

/** Optional long-lived OAuth support. Refresh tokens and client secrets stay server-side. */
export function createYouTubeTokenProvider(
  settings:()=>{accessToken?:string;clientId?:string;clientSecret?:string;refreshToken?:string},
  request:Fetcher=fetch,
  now:()=>number=Date.now
) {
  let cached: {value:string; expiresAt:number} | null=null;
  let pending:Promise<string>|null=null;
  return async ():Promise<string> => {
    const config=settings();
    if (!config.refreshToken && !config.clientId && !config.clientSecret) return config.accessToken ?? "";
    if (!config.refreshToken || !config.clientId || !config.clientSecret) return "";
    if (cached && now() < cached.expiresAt) return cached.value;
    if (pending) return pending;
    pending=(async()=>{
      try {
        const response = await request("https://oauth2.googleapis.com/token",{
          method:"POST",redirect:"error",signal:AbortSignal.timeout(TIMEOUT_MS),
          headers:{"Content-Type":"application/x-www-form-urlencoded","Accept":"application/json"},
          body:new URLSearchParams({client_id:config.clientId!,client_secret:config.clientSecret!,refresh_token:config.refreshToken!,grant_type:"refresh_token"})
        });
        if (!response.ok || Number(response.headers.get("content-length")??"0")>16384) return "";
        const body=await response.text();
        if (body.length>16384) return "";
        const payload:unknown=JSON.parse(body);
        if (!payload || typeof payload!=="object") return "";
        const result=payload as {access_token?:unknown;expires_in?:unknown};
        if (typeof result.access_token!=="string" || result.access_token.length<16) return "";
        const lifetime=typeof result.expires_in==="number"&&Number.isFinite(result.expires_in)
          ? Math.max(60,Math.min(3600,result.expires_in)) : 300;
        cached={value:result.access_token,expiresAt:now() + Math.max(10000,(lifetime-60)*1000)};
        return cached.value;
      } catch { return ""; }
    })().finally(()=>{pending=null;});
    return pending;
  };
}
