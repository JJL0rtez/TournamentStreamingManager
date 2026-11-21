import {LeaseStore} from '../../packages/capture-coordination/store.mjs';
import {createCoordinatorServer} from '../../packages/capture-coordination/server.mjs';
const secret=process.env.TSM_COORDINATOR_SECRET;if(!secret||secret.length<32){console.error('Set TSM_COORDINATOR_SECRET to a random 32+ character value.');process.exit(1);}
const dir=process.env.TSM_COORDINATOR_DATA_DIR||'.tsm-runtime/coordinator';const host=process.env.TSM_COORDINATOR_HOST||'127.0.0.1';const port=Number(process.env.TSM_COORDINATOR_PORT||43177);
const {server,listen}=createCoordinatorServer(new LeaseStore(dir),{secret,host,port});await listen();console.log(`Capture coordinator listening at ${host}:${port}`);for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
