import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";

export interface EventPass {
  schema:1; licenseId:string; eventId:string; issuedAt:string;
  validUntil:string; durationDays:10; maxNodes:number;
  allowedNodeIds:string[];
}
export interface SignedEventPass { payload:EventPass; signature:string; }
export interface ActivationState { licenseId:string; eventId:string; activatedAt:string; }
export type EntitlementStatus = {
  tier:"free"|"event"; reason:string; licenseId:string|null;
  eventId:string|null; activatedAt:string|null; expiresAt:string|null;
  canStartNewCleanOutput:boolean; maxNodes:number;
};
const DAY=86400000;
const safeDate=(s:string)=>{const d=Date.parse(s);return Number.isFinite(d)?d:NaN;};
export function verifyEventPass(document:unknown, publicKeyPem:string, now=Date.now()):EventPass {
  if(!document || typeof document!=="object")throw new Error("Invalid pass envelope");
  const {payload,signature}=document as Partial<SignedEventPass>;
  if(!payload || typeof payload!=="object" || typeof signature!=="string")throw new Error("Missing signed pass fields");
  if(payload.schema!==1 || payload.durationDays!==10 ||
     !/^[a-zA-Z0-9_-]{6,100}$/.test(payload.licenseId??"") ||
     !/^[a-zA-Z0-9_-]{4,100}$/.test(payload.eventId??"") ||
     !Number.isInteger(payload.maxNodes) || payload.maxNodes<1 || payload.maxNodes>64 ||
     !Array.isArray(payload.allowedNodeIds) || payload.allowedNodeIds.length<1 ||
     payload.allowedNodeIds.length>payload.maxNodes ||
     payload.allowedNodeIds.some(id=>typeof id!=="string" || !/^[a-zA-Z0-9_-]{4,128}$/.test(id)))
    throw new Error("Invalid pass claims");
  const issued=safeDate(payload.issuedAt),valid=safeDate(payload.validUntil);
  if(!Number.isFinite(issued) || !Number.isFinite(valid) || valid<=issued ||
     issued>now+5*60_000 || valid<now-365*DAY)throw new Error("Invalid pass dates");
  const key:KeyObject=createPublicKey(publicKeyPem);
  if(key.asymmetricKeyType!=="ed25519")throw new Error("Only Ed25519 event-pass keys are supported");
  // Canonical signing uses exact JSON.stringify(payload) bytes, with key insertion
  // order fixed by the issuer. Never reconstruct/reorder claims before verifying.
  if(!verify(null,Buffer.from(JSON.stringify(payload),"utf8"),key,Buffer.from(signature,"base64")))
    throw new Error("Invalid event-pass signature");
  return payload;
}
export function eventPassStatus(pass:EventPass|null, activation:ActivationState|null, nodeId:string, now=Date.now()):EntitlementStatus {
  const free=(reason:string):EntitlementStatus=>({
    tier:"free",reason,licenseId:pass?.licenseId??null,eventId:pass?.eventId??null,
    activatedAt:activation?.activatedAt??null,expiresAt:null,canStartNewCleanOutput:true,maxNodes:1
  });
  if(!pass)return free("NO_SIGNED_PASS");
  if(!pass.allowedNodeIds.includes(nodeId))return free("NODE_NOT_AUTHORIZED");
  if(!activation || activation.licenseId!==pass.licenseId || activation.eventId!==pass.eventId)
    return free("PASS_NOT_ACTIVATED");
  const start=safeDate(activation.activatedAt);
  if(!Number.isFinite(start) || start>now+5*60_000 || start<safeDate(pass.issuedAt)-5*60_000)
    return free("INVALID_ACTIVATION");
  const expiry=Math.min(start+10*DAY,safeDate(pass.validUntil));
  if(now>=expiry)return free("PASS_EXPIRED_NEW_STARTS_ONLY");
  return {tier:"event",reason:"ACTIVE",licenseId:pass.licenseId,eventId:pass.eventId,
    activatedAt:activation.activatedAt,expiresAt:new Date(expiry).toISOString(),
    canStartNewCleanOutput:true,maxNodes:pass.maxNodes};
}
export class EventEntitlementStore {
  private pass:EventPass|null=null;
  private activation:ActivationState|null=null;
  private readonly directory:string;
  private readonly publicKeyPem:string;
  private readonly nodeId:string;
  constructor(directory:string,publicKeyPem:string,nodeId:string){
    this.directory=directory;this.publicKeyPem=publicKeyPem;this.nodeId=nodeId;
  }
  async load(now=Date.now()):Promise<void>{
    try {
      const envelope=JSON.parse(await readFile(path.join(this.directory,"pass.json"),"utf8")) as unknown;
      this.pass=verifyEventPass(envelope,this.publicKeyPem,now);
    }catch {this.pass=null;}
    try {
      const activation=JSON.parse(await readFile(path.join(this.directory,"activation.json"),"utf8")) as ActivationState;
      this.activation=activation && typeof activation.activatedAt==="string"?activation:null;
    }catch {this.activation=null;}
  }
  status(now=Date.now()){return eventPassStatus(this.pass,this.activation,this.nodeId,now);}
  async install(document:unknown,now=Date.now()):Promise<EntitlementStatus>{
    const verified=verifyEventPass(document,this.publicKeyPem,now);
    if(!verified.allowedNodeIds.includes(this.nodeId))throw new Error("This node is not authorized for the pass");
    if(this.activation && this.pass && this.pass.licenseId!==verified.licenseId)
      throw new Error("An activated pass is already installed; manual operator reset required");
    await mkdir(this.directory,{recursive:true});
    const file=path.join(this.directory,"pass.json");
    const temp=file+".new";
    await writeFile(temp,JSON.stringify(document),{mode:0o600,flag:"w"});
    await rename(temp,file);
    this.pass=verified;
    return this.status(now);
  }
  async activate(now=Date.now()):Promise<EntitlementStatus>{
    if(!this.pass)throw new Error("No verified pass installed");
    if(!this.pass.allowedNodeIds.includes(this.nodeId))throw new Error("Node not authorized");
    if(this.activation && this.activation.licenseId===this.pass.licenseId)
      return this.status(now);
    if(now>=safeDate(this.pass.validUntil))throw new Error("Pass validity window ended");
    const activation={licenseId:this.pass.licenseId,eventId:this.pass.eventId,activatedAt:new Date(now).toISOString()};
    await mkdir(this.directory,{recursive:true});
    const file=path.join(this.directory,"activation.json"),temp=file+".new";
    await writeFile(temp,JSON.stringify(activation),{mode:0o600,flag:"w"});
    await rename(temp,file);
    this.activation=activation;
    return this.status(now);
  }
}
