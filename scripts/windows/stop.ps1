param([ValidateSet('node','dashboard','both')][string]$Role='both')
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Project
$roles = if($Role -eq 'both'){@('node','dashboard')}else{@($Role)}
foreach($item in $roles) {
  $proc = Get-ManagedProcess $item
  if (-not $proc) { Write-Host "$item not running or PID ownership could not be confirmed"; continue }
  # Do not kill child FFmpeg processes: capture continuity is managed by the Node service.
  Stop-Process -Id $proc.ProcessId -ErrorAction Stop
  Remove-Item (Join-Path $script:RuntimeDir "$item.json") -ErrorAction SilentlyContinue
  Write-Host "Stopped managed $item launcher"
}
