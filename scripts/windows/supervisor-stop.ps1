param([ValidateSet('node','dashboard','both')][string]$Role='both')
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Project
$roles=if($Role -eq 'both'){@('node','dashboard')}else{@($Role)}
foreach($item in $roles){
 $file=Join-Path $script:RuntimeDir "$item.supervisor.json"
 if(-not (Test-Path $file)){continue}
 $state=Get-Content $file -Raw | ConvertFrom-Json
 $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$($state.supervisorPid)" -ErrorAction SilentlyContinue
 if(-not $proc -or $proc.CommandLine -notmatch 'supervisor.mjs'){Write-Warning "$item PID not verified; refusing stop";continue}
 Write-Warning "Stopping supervisor does NOT guarantee child capture processes stop. Do not use during an event."
 Stop-Process -Id $state.supervisorPid -ErrorAction Stop
}
