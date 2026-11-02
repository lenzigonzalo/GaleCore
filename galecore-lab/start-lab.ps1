param([switch]$Background)
$ErrorActionPreference = 'Stop'
$labRoot = $PSScriptRoot
# Datos de GaleCore del usuario; no se imprimen ni se guardan credenciales del proveedor.
foreach ($labName in @('GALECORE_API_KEY','GALECORE_BASE_URL','GALECORE_USERNAME','GALECORE_PASSWORD','GALECORE_TIMEOUT_SECONDS','ALLOW_UNKNOWN_FRESHNESS','MAX_STALENESS_SECONDS')) {
    $labValue = [Environment]::GetEnvironmentVariable($labName, 'User')
    if ($labValue) { [Environment]::SetEnvironmentVariable($labName, $labValue, 'Process') }
}
# Solo para el Lab (WS-0074): GALECORE_LAB_BASE_URL / _API_KEY / _USERNAME / _PASSWORD apuntan el Lab a
# produccion sin mover el resto del tooling de la PC, que sigue contra la API local de desarrollo.
foreach ($labName in @('BASE_URL','API_KEY','USERNAME','PASSWORD')) {
    $labValue = [Environment]::GetEnvironmentVariable("GALECORE_LAB_$labName", 'User')
    if ($labValue) { [Environment]::SetEnvironmentVariable("GALECORE_$labName", $labValue, 'Process') }
}
$labNode = (Get-Command node -ErrorAction Stop).Source
if ($Background) {
    $labLogs = Join-Path $labRoot '.local'
    New-Item -ItemType Directory -Force -Path $labLogs | Out-Null
    Start-Process -FilePath $labNode -ArgumentList 'lab-server.js' -WorkingDirectory $labRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $labLogs 'lab.stdout.log') -RedirectStandardError (Join-Path $labLogs 'lab.stderr.log')
} else {
    & $labNode (Join-Path $labRoot 'lab-server.js')
}
