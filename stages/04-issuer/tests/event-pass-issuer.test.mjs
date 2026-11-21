import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,readFile,rm } from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {generateIssuerKeys,issueFromFile,makePayload,signPayload} from "../scripts/event-pass-issuer.mjs";
import {verify,createPublicKey} from "node:crypto";
test("issuer generates valid keys, signs a 2-node event pass, and never overwrites",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"tsm-issuer-"));
 try{
  const priv=path.join(dir,"private.pem"),pub=path.join(dir,"public.pem");
  const claims=path.join(dir,"claims.json"),out=path.join(dir,"pass.json");
  await generateIssuerKeys(priv,pub);
  await assert.rejects(generateIssuerKeys(priv,pub),/EEXIST/);
  const issuedAt="2026-11-19T12:00:00.000Z";
  const payload=makePayload({licenseId:"license-2027",eventId:"march2027",issuedAt,
    validUntil:"2027-04-01T12:00:00.000Z",allowedNodeIds:["host-01","host-02"]});
  const {writeFile}=await import("node:fs/promises");
  await writeFile(claims,JSON.stringify(payload));
  const result=await issueFromFile({input:claims,keyFile:priv,output:out});
  assert.equal(result.nodes,2);
  const envelope=JSON.parse(await readFile(out,"utf8"));
  assert.equal(envelope.payload.durationDays,10);
  assert.ok(verify(null,Buffer.from(JSON.stringify(envelope.payload)),
    createPublicKey(await readFile(pub,"utf8")),Buffer.from(envelope.signature,"base64")));
  await assert.rejects(issueFromFile({input:claims,keyFile:priv,output:out}),/EEXIST/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("issuer refuses duplicate node ids, invalid IDs, and invalid dates",()=>{
 assert.throws(()=>makePayload({licenseId:"license-1",eventId:"evt-1",issuedAt:"2026-01-01",
 validUntil:"2026-01-02",allowedNodeIds:["node-1","node-1"]}),/node list/);
 assert.throws(()=>makePayload({licenseId:"bad",eventId:"evt-1",issuedAt:"2026-01-01",
 validUntil:"2026-01-02",allowedNodeIds:["node-1"]}),/licenseId/);
});
