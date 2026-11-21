/** Remote monitoring transport: bounded, read-only failover with no write replay. */
export type TransportKind = "tailscale" | "lan" | "primary";
export interface Endpoint { url: string; kind: TransportKind }
export interface Attempt { endpoint: Endpoint; ok: boolean; status?: number; elapsedMs: number; error?: string }
export interface ProbeResult { response: Response; endpoint: Endpoint; attempts: Attempt[] }
const allowedSchemes = new Set(["http:", "https:"]);
export function normalizeEndpoints(primary: string, lan?: string, tailscale?: string): Endpoint[] {
  const candidates: Endpoint[] = [
    ...(tailscale ? [{url:tailscale,kind:"tailscale" as const}] : []),
    ...(lan ? [{url:lan,kind:"lan" as const}] : []),
    {url:primary,kind:"primary"}
  ];
  const seen = new Set<string>();
  return candidates.map(candidate=>{
    const url = new URL(candidate.url);
    if (!allowedSchemes.has(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      throw new Error("Peer endpoints must be plain http(s) origins without credentials, paths or queries");
    return {...candidate,url:url.origin};
  }).filter(candidate=>{
    if(seen.has(candidate.url))return false;
    seen.add(candidate.url);return true;
  });
}
export class PeerTransport {
  private lastGood = new Map<string,string>();
  private lastAttempts = new Map<string,Attempt[]>();
  private readonly fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = fetch) {this.fetcher=fetcher;}
  report(id:string): {preferred:string|null;attempts:Attempt[]} {
    return {preferred:this.lastGood.get(id)??null,attempts:[...(this.lastAttempts.get(id)??[])]};
  }
  async request(id:string,endpoints:Endpoint[],route:string,token:string,options:{method?:"GET"|"POST"|"PUT";body?:string;timeoutMs?:number}={}):Promise<ProbeResult> {
    if(!route.startsWith("/api/") || route.includes("//") || route.includes(".."))throw new Error("Invalid API route");
    const method=options.method??"GET";
    const previous=this.lastGood.get(id);
    const ordered=method==="GET" && previous
      ? [...endpoints.filter(e=>e.url===previous),...endpoints.filter(e=>e.url!==previous)] : endpoints;
    const attempts:Attempt[]=[];
    // Never replay POST/PUT across links: a timeout might follow a successful action.
    const targets=method==="GET"?ordered:ordered.slice(0,1);
    for(const endpoint of targets){
      const started=Date.now();
      try {
        const response=await this.fetcher(`${endpoint.url}${route}`,{
          method,headers:{"x-tournament-node-token":token,...(options.body?{"content-type":"application/json"}:{})},
          body:options.body,signal:AbortSignal.timeout(options.timeoutMs??2500)
        });
        attempts.push({endpoint,ok:response.ok,status:response.status,elapsedMs:Date.now()-started});
        if(response.ok || method!=="GET" || (response.status!==502 && response.status!==503 && response.status!==504)){
          if(response.ok)this.lastGood.set(id,endpoint.url);
          this.lastAttempts.set(id,attempts);
          return {response,endpoint,attempts};
        }
      } catch(error){
        attempts.push({endpoint,ok:false,elapsedMs:Date.now()-started,error:error instanceof Error?error.message:String(error)});
        if(method!=="GET")break;
      }
    }
    this.lastAttempts.set(id,attempts);
    throw new Error(`All available transports failed for ${id}: ${attempts.map(a=>`${a.endpoint.kind}=${a.status??a.error}`).join(", ")}`);
  }
}
