param([string]$RecordingDirectory = '', [int]$MinFreeGiB = 50)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Project
$results = @()
foreach ($name in @('node.exe','npm.cmd','ffmpeg.exe','ffprobe.exe')) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  $results += [pscustomobject]@{Check=$name;Pass=[bool]$cmd;Detail=if($cmd){$cmd.Source}else{'Missing'}}
}
if ($RecordingDirectory) {
  $exists = Test-Path -LiteralPath $RecordingDirectory -PathType Container
  $results += [pscustomobject]@{Check='Recording directory';Pass=$exists;Detail=$RecordingDirectory}
  if ($exists) {
    $driveRoot = [System.IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $RecordingDirectory).Path)
    $disk = [System.IO.DriveInfo]::new($driveRoot)
    $free = [math]::Round($disk.AvailableFreeSpace/1GB,1)
    $results += [pscustomobject]@{Check='Recording free space';Pass=($free -ge $MinFreeGiB);Detail="$free GiB free; minimum $MinFreeGiB GiB"}
  }
}
$results | Format-Table -AutoSize
New-Item -ItemType Directory -Force -Path $script:RuntimeDir | Out-Null
$results | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $script:RuntimeDir 'preflight.json') -Encoding UTF8
if (@($results | Where-Object {-not $_.Pass}).Count -gt 0) { exit 1 }
