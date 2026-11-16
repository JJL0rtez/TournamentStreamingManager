/** Read-only full decode and audio/black/freeze/silence checks for completed recordings. */
import {writeFile} from 'node:fs/promises';
import {analyze,listRecordings,mapLimit,validateArgs} from './recording-deep-lib.mts';
const argv=process.argv.slice(2);const val=(k:string,d:string)=>{const i=argv.indexOf(k);return i>=0?argv[i+1]:d;};
if(argv.includes('--help')){console.log('npm run recording:deep -- --dir recordings --recursive --limit 10 --concurrency 2 --timeout 180 [--report report.json]');process.exit(0);}
const dir=val('--dir','recordings'),limit=Number(val('--limit','10')),concurrency=Number(val('--concurrency','2')),timeout=Number(val('--timeout','180'));
try{
 validateArgs(concurrency,limit,timeout);
 const files=await listRecordings(dir,argv.includes('--recursive'),limit);
 if(!files.length)throw Error('No completed recordings found');
 const config={ffmpeg:val('--ffmpeg','ffmpeg'),ffprobe:val('--ffprobe','ffprobe'),timeout,minSeconds:Number(val('--min-seconds','3')),maxBlackRatio:Number(val('--max-black-ratio','0.10')),maxFreezeRatio:Number(val('--max-freeze-ratio','0.20')),maxSilenceRatio:Number(val('--max-silence-ratio','0.80')),silenceDb:Number(val('--silence-db','-55'))};
 const results=await mapLimit(files,concurrency,async x=>{try{return await analyze(x.file,x.bytes,config);}catch(e){return {file:x.file,bytes:x.bytes,findings:[{code:'analysis',level:'error',message:String(e)}]};}});
 const summary={filesChecked:results.length,errors:results.flatMap(x=>x.findings).filter(f=>f.level==='error').length,warnings:results.flatMap(x=>x.findings).filter(f=>f.level==='warning').length,readOnly:true,results};
 console.log(JSON.stringify(summary,null,2));
 const report=val('--report','');if(report)await writeFile(report,JSON.stringify(summary,null,2));
 if(summary.errors)process.exitCode=1;
}catch(e){console.error(String(e));process.exitCode=2;}
