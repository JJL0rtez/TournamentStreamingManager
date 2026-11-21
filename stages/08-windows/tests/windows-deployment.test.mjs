import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = new URL('../scripts/windows/', import.meta.url);
async function script(name) { return readFile(new URL(name, root), 'utf8'); }
test('all deployment commands use the shared project root and strict errors', async () => {
  for(const name of ['install','preflight','start','stop','status','logs','backup']) {
    const source=await script(`${name}.ps1`);
    assert.match(source,/common\.ps1/);
    assert.match(source,/Assert-Project/);
  }
});
test('installation rejects missing dependencies and fails on build errors',async()=>{
  const source=await script('install.ps1');
  for(const dependency of ['node.exe','npm.cmd','ffmpeg.exe'])assert.ok(source.includes(dependency));
  assert.match(source,/npm ci/);
  assert.match(source,/npm run typecheck/);
  assert.match(source,/npm run build/);
  assert.match(source,/LASTEXITCODE -ne 0/);
});
test('preflight validates recording directory and disk free space',async()=>{
  const source=await script('preflight.ps1');
  assert.match(source,/RecordingDirectory/);
  assert.match(source,/AvailableFreeSpace/);
  assert.match(source,/preflight\.json/);
});
test('start, stop and status share PID ownership validation',async()=>{
  const common=await script('common.ps1');
  for(const name of ['start','stop','status'])assert.match(await script(`${name}.ps1`),/Get-ManagedProcess/);
  assert.match(common,/CreationDate/);
  assert.match(common,/createdAt/);
  assert.doesNotMatch(await script('stop.ps1'),/taskkill|Stop-Process.*-Force/);
});
test('backup refuses overwrites and excludes recordings',async()=>{
  const source=await script('backup.ps1');
  assert.match(source,/Destination already exists/);
  assert.doesNotMatch(source,/recordings|\.mkv|\.mp4/i);
});
test('no PowerShell script silently changes firewall or installs system services',async()=>{
  for(const name of ['common','install','preflight','start','stop','status','logs','backup']){
    const source=await script(`${name}.ps1`);
    assert.doesNotMatch(source,/New-NetFirewallRule|sc\.exe create|Register-ScheduledTask|Set-ExecutionPolicy/i);
  }
});
