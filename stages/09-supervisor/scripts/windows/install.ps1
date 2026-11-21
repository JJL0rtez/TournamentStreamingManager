param([switch]$SkipNpmInstall, [switch]$SkipBuild)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Project
$node = Assert-Command 'node.exe'
$npm = Assert-Command 'npm.cmd'
$ffmpeg = Assert-Command 'ffmpeg.exe'
$nodeVersion = & $node --version
$major = [int]($nodeVersion -replace '^v(\d+).*','$1')
if ($major -lt 22) { throw "Node.js 22+ required for this development deployment; detected $nodeVersion" }
New-Item -ItemType Directory -Force -Path $script:RuntimeDir | Out-Null
Write-Host "Project: $script:ProjectRoot"
Write-Host "Node: $nodeVersion"
Write-Host "FFmpeg: $ffmpeg"
Push-Location $script:ProjectRoot
try {
  if (-not $SkipNpmInstall) { & $npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } }
  if (-not $SkipBuild) {
    & $npm run typecheck; if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed' }
    & $npm run build; if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
  }
} finally { Pop-Location }
Write-Host 'Development deployment prepared. Run preflight.ps1 before starting services.'
