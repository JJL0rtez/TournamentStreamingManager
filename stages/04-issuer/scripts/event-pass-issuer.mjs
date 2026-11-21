#!/usr/bin/env node
// Offline issuer utility. Keep private keys on an issuer machine, never on capture nodes.
import { generateKeyPairSync, sign, createPrivateKey } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DAY = 86400000;
export function makePayload({licenseId,eventId,allowedNodeIds,issuedAt,validUntil}) {
  if(!/^[a-zA-Z0-9_-]{6,100}$/.test(licenseId??""))throw new Error("Invalid licenseId");
  if(!/^[a-zA-Z0-9_-]{4,100}$/.test(eventId??""))throw new Error("Invalid eventId");
  if(!Array.isArray(allowedNodeIds)||allowedNodeIds.length<1||allowedNodeIds.length>64||
     new Set(allowedNodeIds).size!==allowedNodeIds.length||
     allowedNodeIds.some(x=>typeof x!=="string"||!/^[a-zA-Z0-9_-]{4,128}$/.test(x)))
    throw new Error("Invalid node list");
  if(!Number.isFinite(Date.parse(issuedAt))||!Number.isFinite(Date.parse(validUntil))||
     Date.parse(validUntil)<=Date.parse(issuedAt))throw new Error("Invalid validity dates");
  return {schema:1,licenseId,eventId,issuedAt,validUntil,durationDays:10,
    maxNodes:allowedNodeIds.length,allowedNodeIds};
}
export function signPayload(payload,privateKeyPem) {
  const key=createPrivateKey(privateKeyPem);
  if(key.asymmetricKeyType!=="ed25519")throw new Error("Ed25519 private key required");
  return {payload,signature:sign(null,Buffer.from(JSON.stringify(payload),"utf8"),key).toString("base64")};
}
export async function issueFromFile({input,keyFile,output}) {
  const raw=JSON.parse(await readFile(input,"utf8"));
  const payload=makePayload(raw);
  const privateKey=await readFile(keyFile,"utf8");
  const envelope=signPayload(payload,privateKey);
  await mkdir(path.dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(envelope,null,2)+"\n",{mode:0o600,flag:"wx"});
  return {output,licenseId:payload.licenseId,eventId:payload.eventId,nodes:payload.allowedNodeIds.length};
}
export async function generateIssuerKeys(privatePath,publicPath) {
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  await mkdir(path.dirname(privatePath),{recursive:true});
  await mkdir(path.dirname(publicPath),{recursive:true});
  // wx: never overwrite keys, even accidentally.
  await writeFile(privatePath,privateKey.export({type:"pkcs8",format:"pem"}),{mode:0o600,flag:"wx"});
  await writeFile(publicPath,publicKey.export({type:"spki",format:"pem"}),{flag:"wx"});
}
async function main() {
  const [command,...args]=process.argv.slice(2);
  if(command==="keygen" && args.length===2) {
    await generateIssuerKeys(...args);
    console.log("Issuer keys created. Keep the private key offline and out of Git.");
  } else if(command==="issue" && args.length===3) {
    console.log(await issueFromFile({input:args[0],keyFile:args[1],output:args[2]}));
  } else {
    console.error("Usage: node scripts/event-pass-issuer.mjs keygen PRIVATE.pem PUBLIC.pem");
    console.error("       node scripts/event-pass-issuer.mjs issue claims.json PRIVATE.pem pass.json");
    process.exitCode=2;
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
