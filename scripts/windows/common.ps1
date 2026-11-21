Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$script:RuntimeDir = Join-Path $script:ProjectRoot '.tsm-runtime'
function Assert-Command([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "Required command missing: $Name" }
  return $cmd.Source
}
function Assert-Project {
  if (-not (Test-Path (Join-Path $script:ProjectRoot 'package.json'))) { throw 'Project root missing package.json' }
  $package = Get-Content (Join-Path $script:ProjectRoot 'package.json') -Raw | ConvertFrom-Json
  if ($package.name -ne 'tournament-streaming') { throw 'Unexpected package.json; refusing to operate on this directory' }
}
function Get-ManagedState([string]$Role) {
  $stateFile = Join-Path $script:RuntimeDir "$Role.json"
  if (-not (Test-Path $stateFile)) { return $null }
  return Get-Content $stateFile -Raw | ConvertFrom-Json
}
function Get-ManagedProcess([string]$Role) {
  $state = Get-ManagedState $Role
  if (-not $state) { return $null }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($state.pid)" -ErrorAction SilentlyContinue
  if (-not $proc) { return $null }
  if ($proc.CreationDate -and $state.createdAt) {
    $actual = ([datetime]$proc.CreationDate).ToUniversalTime()
    $expected = ([datetime]$state.createdAt).ToUniversalTime()
    if ([math]::Abs(($actual-$expected).TotalSeconds) -gt 3) { return $null }
  }
  return $proc
}
