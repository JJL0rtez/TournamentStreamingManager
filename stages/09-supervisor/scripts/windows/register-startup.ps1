param([ValidateSet('node','dashboard','both')][string]$Role='both',[switch]$Remove)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Project
$taskName='TournamentStreaming-Supervisor-'+$Role
if($Remove){Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop;Write-Host "Removed $taskName";return}
# Run at the current user's logon, not SYSTEM. No admin elevation required.
$exe=(Get-Command 'powershell.exe').Source
$launcher=Join-Path $PSScriptRoot 'supervisor-start.ps1'
$action=New-ScheduledTaskAction -Execute $exe -Argument ('-NoProfile -ExecutionPolicy Bypass -File "'+$launcher+'" -Role '+$Role) -WorkingDirectory $script:ProjectRoot
$trigger=New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'TournamentStreaming supervisor at user logon' -Force | Out-Null
Write-Host "Registered $taskName for current user logon. Verify task permissions and startup before tournament."
