#!/usr/bin/env node
import {checkCaptureRestartSafety} from './capture-safety.mjs';
const status=await checkCaptureRestartSafety();
console.log(JSON.stringify({...status,checkedAt:new Date().toISOString()},null,2));
if(!status.safe)process.exitCode=2;
