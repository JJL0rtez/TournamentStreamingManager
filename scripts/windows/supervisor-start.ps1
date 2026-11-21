param([ValidateSet('node','dashboard','both')][string]$Role='both')
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Project
$node = Assert-Command 'node.exe'
New-Item -ItemType Directory -Force -Path $script:RuntimeDir | Out-Null
$roles = if($Role -eq 'both'){@('node','dashboard')}else{@($Role)}
foreach($item in $roles){
  $file = Join-Path $script:RuntimeDir "$item.supervisor.json"
  if(Test-Path $file){
    $state = Get-Content $file -Raw | ConvertFrom-Json
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$($state.supervisorPid)" -ErrorAction SilentlyContinue
    if($existing -and $existing.CommandLine -match 'supervisor.mjs'){Write-Host "$item supervisor already running";continue}
  }
  $launcher=Join-Path $PSScriptRoot 'supervisor.mjs'
  $stdout=Join-Path $script:RuntimeDir "$item.launcher.stdout.log"
  $stderr=Join-Path $script:RuntimeDir "$item.launcher.stderr.log"
  $proc=Start-Process -FilePath $node -ArgumentList @('"'+$launcher+'"',$item) -WorkingDirectory $script:ProjectRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
  Write-Host "Started $item supervisor PID $($proc.Id)"
}
