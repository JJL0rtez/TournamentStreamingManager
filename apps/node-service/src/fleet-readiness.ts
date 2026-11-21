export interface FleetNodeSnapshot {
  id:string; name:string; local:boolean; online:boolean; checkedAt:string;
  latencyMs:number|null; health:unknown|null; storage:unknown|null;
  captures:unknown|null; entitlement:unknown|null; errors:string[];
}
export interface FleetReadinessReport {
  checkedAt:string; nodes:FleetNodeSnapshot[];
  summary:{total:number;online:number;offline:number;nodesWithWarnings:number;allOnline:boolean};
  warnings:string[];
}
export function summarizeFleet(nodes:FleetNodeSnapshot[], now=new Date().toISOString()):FleetReadinessReport {
  const ids=new Set<string>();
  const warnings:string[]=[];
  for(const node of nodes){
    if(ids.has(node.id))warnings.push(`Duplicate node ID: ${node.id}`);
    ids.add(node.id);
    if(!node.online)warnings.push(`${node.name} (${node.id}) is unreachable; its capture may still be running independently.`);
    for(const error of node.errors)warnings.push(`${node.name}: ${error}`);
  }
  const online=nodes.filter(n=>n.online).length;
  return {checkedAt:now,nodes,summary:{total:nodes.length,online,offline:nodes.length-online,
    nodesWithWarnings:nodes.filter(n=>!n.online||n.errors.length>0).length,
    allOnline:online===nodes.length},warnings};
}
export function safeNodeId(id:unknown):id is string {
  return typeof id==="string" && /^[a-zA-Z0-9_-]{1,40}$/.test(id);
}
export function selectNodeStatus(response:unknown):unknown|null {
  if(!response || typeof response!=="object" || Array.isArray(response))return null;
  return response;
}
