param([string]$Destination='')
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Project
if(-not $Destination){$Destination=Join-Path $script:RuntimeDir ('support-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.zip')}
New-Item -ItemType Directory -Force -Path $script:RuntimeDir | Out-Null
$temp=Join-Path $env:TEMP ('tsm-support-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temp | Out-Null
try{
  $summary=[pscustomobject]@{createdAt=(Get-Date).ToUniversalTime().ToString('o');hostname=$env:COMPUTERNAME;windows=[System.Environment]::OSVersion.VersionString;node=(& node --version 2>&1 | Out-String).Trim();roles=@()}
  foreach($role in @('node','dashboard')){
    $stateFile=Join-Path $script:RuntimeDir "$role.supervisor.json"
    if(Test-Path $stateFile){
      $state=Get-Content $stateFile -Raw | ConvertFrom-Json
      $summary.roles+=([pscustomobject]@{role=$role;status=$state.status;crashes=$state.crashes;lastHealth=$state.lastHealth})
    }
  }
  $summary | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $temp 'summary.json') -Encoding UTF8
  foreach($name in @('preflight.json','node.supervisor.log','dashboard.supervisor.log')){
    $source=Join-Path $script:RuntimeDir $name
    if(Test-Path $source){Copy-Item -LiteralPath $source -Destination (Join-Path $temp $name)}
  }
  # Do not collect env files, license material, private keys, camera recordings,
  # stdout/stderr (may contain YouTube keys), or network tokens.
  Compress-Archive -Path (Join-Path $temp '*') -DestinationPath $Destination -Force
  Write-Host "Created support bundle $Destination. Review before sharing."
}finally{Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue}
