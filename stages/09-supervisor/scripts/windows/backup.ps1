param([string]$Destination = '')
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Project
if (-not $Destination) { $Destination = Join-Path $script:ProjectRoot ('.tsm-backups/config-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.zip') }
$files = @('.tsm-entitlement','apps/node-service/config','apps/node-service/data','.env')
$present = @($files | Where-Object {Test-Path (Join-Path $script:ProjectRoot $_)})
if ($present.Count -eq 0) { throw 'No known configuration paths found. Nothing backed up.' }
$destFull = [System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path (Split-Path $destFull -Parent) | Out-Null
if (Test-Path $destFull) { throw 'Destination already exists; refusing to overwrite' }
Push-Location $script:ProjectRoot
try { Compress-Archive -Path $present -DestinationPath $destFull -CompressionLevel Optimal }
finally { Pop-Location }
Write-Host "Configuration backup: $destFull"
Write-Warning 'Backup may contain secrets. Keep it private. Recording videos are intentionally excluded.'
