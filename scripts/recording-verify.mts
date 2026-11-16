/** Read-only ffprobe audit of existing MKV/MP4 recordings. Never starts or stops cameras. */
import {spawn} from 'node:child_process';
import {findRecordings,inspect,summarize,validateDirectory,type Probe} from './recording-verify-lib.mts';
const args=process.argv.slice(2);const arg=(flag:string)=>{const index=args.indexOf(flag);return index<0?undefined:args[index+1];};
if(args.includes('--help')){console.log('npm run recording:verify -- --dir recordings [--limit 10] [--recursive] [--min-seconds 3] [--ffprobe ffprobe]');process.exit(0);}
const limit=Number(arg('--limit')||'10');const minSeconds=Number(arg('--min-seconds')||'3');if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isFinite(minSeconds)||minSeconds<0){console.error('Invalid --limit (1..200) or --min-seconds (>=0)');process.exit(2);}
const ffprobe=arg('--ffprobe')||'ffprobe';
async function probe(file:string):Promise<Probe>{return new Promise((resolve,reject)=>{const child=spawn(ffprobe,['-v','error','-show_entries','stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels:format=duration,size,format_name','-of','json',file],{windowsHide:true});let output='';let error='';const timer=setTimeout(()=>child.kill(),15000);child.stdout.on('data',(x:Buffer)=>{output+=x.toString();if(output.length>2_000_000)child.kill();});child.stderr.on('data',(x:Buffer)=>{error+=x.toString().slice(0,2000);});child.on('error',reject);child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(Error(`ffprobe failed (exit ${code}): ${error.slice(0,300)}`));else{try{resolve(JSON.parse(output));}catch{reject(Error('ffprobe returned invalid JSON'));}}});});}
try{
 const directory=validateDirectory(arg('--dir')||'recordings');const files=(await findRecordings(directory,args.includes('--recursive'))).slice(0,limit);if(!files.length){console.error('No MKV or MP4 recordings found in '+directory);process.exitCode=2;}else{
 let errors=0;for(const {file,info} of files){try{const findings=inspect(await probe(file),info.size,minSeconds);const summary=summarize(findings);errors+=summary.errors;console.log(JSON.stringify({file,summary,findings},null,2));}catch(e){errors++;console.error(JSON.stringify({file,error:e instanceof Error?e.message:String(e)}));}}
 console.log(JSON.stringify({filesChecked:files.length,errors,readOnly:true,notes:['ffprobe metadata does not prove every frame decodes','Audio presence does not prove audible microphone input','Verify live YouTube playback separately']},null,2));if(errors)process.exitCode=1;
 }
}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=2;}
