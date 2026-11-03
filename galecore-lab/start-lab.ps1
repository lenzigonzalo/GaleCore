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
# WS-0082: en un checkout de main limpio trae lo ultimo antes de arrancar (si falla, arranca igual con lo que hay).
try {
    $labRepo = Split-Path -Parent $labRoot
    if ((& git -C $labRepo rev-parse --abbrev-ref HEAD 2>$null) -eq 'main' -and -not (& git -C $labRepo status --porcelain 2>$null)) {
        & git -C $labRepo pull --ff-only origin main 2>&1 | Out-Null
        $labLock = Join-Path $labRoot 'package-lock.json'
        $labMark = Join-Path $labRoot 'node_modules\.package-lock.json'
        if ((-not (Test-Path $labMark)) -or ((Get-Item $labLock).LastWriteTime -gt (Get-Item $labMark).LastWriteTime)) {
            Push-Location $labRoot; try { & npm.cmd ci --no-audit --no-fund 2>&1 | Out-Null } finally { Pop-Location }
        }
    }
} catch { }
$labNode = (Get-Command node -ErrorAction Stop).Source
if ($Background) {
    $labLogs = Join-Path $labRoot '.local'
    New-Item -ItemType Directory -Force -Path $labLogs | Out-Null
    $labProc = Start-Process -FilePath $labNode -ArgumentList 'lab-server.js' -WorkingDirectory $labRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $labLogs 'lab.stdout.log') -RedirectStandardError (Join-Path $labLogs 'lab.stderr.log') -PassThru
    # Si lo inicio iniciar.ps1, "Detener GaleCore" busca el Lab por este registro: se actualiza con el proceso nuevo.
    $labPidFile = Join-Path $env:LOCALAPPDATA 'GaleCore\pids.json'
    if ($labProc -and (Test-Path $labPidFile)) {
        try {
            $labReg = @(Get-Content $labPidFile -Raw | ConvertFrom-Json)
            if ($labReg | Where-Object { $_.Servicio -eq 'Lab' }) {
                foreach ($r in $labReg) { if ($r.Servicio -eq 'Lab') { $r.Pid = $labProc.Id; $r.Inicio = $labProc.StartTime.ToUniversalTime().ToString('o') } }
                ConvertTo-Json -InputObject @($labReg) | Set-Content -Path $labPidFile -Encoding UTF8
            }
        } catch { }
    }
} else {
    & $labNode (Join-Path $labRoot 'lab-server.js')
}
