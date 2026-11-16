# Execute from the project root. Logs are local and may contain machine paths.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $root 'test-results'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$steps = @(@('static', 'node scripts/core-check.mjs'), @('typecheck', 'npm run typecheck'), @('build', 'npm run build'))
$failed = $false
foreach ($step in $steps) {
  $name = $step[0]; $command = $step[1]
  Write-Host "Running $name : $command"
  & cmd.exe /d /s /c "$command 2>&1" | Tee-Object -FilePath (Join-Path $logDir "$name.log")
  if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Warning "$name failed (exit $LASTEXITCODE)" }
}
if ($failed) { exit 1 }
Write-Host 'All baseline checks passed.'
