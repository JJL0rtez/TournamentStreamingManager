param([ValidateSet('node','dashboard','both')][string]$Role='both')
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Project
$npm = Assert-Command 'npm.cmd'
New-Item -ItemType Directory -Force -Path $script:RuntimeDir | Out-Null
$roles = if($Role -eq 'both'){@('node','dashboard')}else{@($Role)}
foreach ($item in $roles) {
  if (Get-ManagedProcess $item) { Write-Host "$item already running"; continue }
  $scriptName = if($item -eq 'node'){'dev:node'}else{'dev'}
  $stdout = Join-Path $script:RuntimeDir "$item.stdout.log"
  $stderr = Join-Path $script:RuntimeDir "$item.stderr.log"
  $proc = Start-Process -FilePath $npm -ArgumentList @('run',$scriptName) -WorkingDirectory $script:ProjectRoot -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden
  # Record creation time to guard against accidental PID reuse on stop.
  $created = (Get-Process -Id $proc.Id).StartTime.ToUniversalTime().ToString('o')
  [pscustomobject]@{pid=$proc.Id;createdAt=$created;role=$item;script=$scriptName} | ConvertTo-Json | Set-Content (Join-Path $script:RuntimeDir "$item.json") -Encoding UTF8
  Write-Host "Started $item PID $($proc.Id), logs: $stdout"
}
