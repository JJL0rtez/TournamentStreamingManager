. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Project
foreach($role in @('node','dashboard')){
  $file=Join-Path $script:RuntimeDir "$role.supervisor.json"
  if(-not (Test-Path $file)){Write-Host "$role : no supervisor state";continue}
  $state=Get-Content $file -Raw | ConvertFrom-Json
  $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$($state.supervisorPid)" -ErrorAction SilentlyContinue
  $owned=[bool]($proc -and $proc.CommandLine -match 'supervisor.mjs')
  [pscustomobject]@{Role=$role;Supervisor=if($owned){'Running'}else{'Not running'};ChildPID=$state.childPid;State=$state.status;Crashes=$state.crashes;Health=if($state.lastHealth){$state.lastHealth.ok}else{'Unknown'}} | Format-List
}
