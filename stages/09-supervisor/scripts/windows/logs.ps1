param([ValidateSet('node','dashboard')][string]$Role='node',[int]$Tail=80)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Project
$file = Join-Path $script:RuntimeDir "$Role.stdout.log"
if (-not (Test-Path $file)) { throw "Log not found: $file" }
Get-Content -LiteralPath $file -Tail ([math]::Max(1,[math]::Min(5000,$Tail)))
