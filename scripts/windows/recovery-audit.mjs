#!/usr/bin/env node
import { captureOwnershipReport } from './process-ownership.mjs';
import { checkCaptureRestartSafety } from './capture-safety.mjs';
const [ownership,safety]=await Promise.all([captureOwnershipReport(),checkCaptureRestartSafety()]);
const report={at:new Date().toISOString(),ownership,safety,restartAllowed:ownership.canRestart&&safety.safe};
console.log(JSON.stringify(report,null,2));
if(!report.restartAllowed)process.exitCode=2;
