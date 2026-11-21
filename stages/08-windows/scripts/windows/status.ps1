. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Project
$rows = @(foreach($role in @('node','dashboard')) {
  $state = Get-ManagedState $role
  $proc = Get-ManagedProcess $role
  [pscustomobject]@{Role=$role;Status=if($proc){'Running'}else{'Stopped'};PID=if($proc){$proc.ProcessId}else{$null};Log=(Join-Path $script:RuntimeDir "$role.stdout.log")}
})
$rows | Format-Table -AutoSize
