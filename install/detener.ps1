<#
.SYNOPSIS
  Detiene GaleCore: solo los procesos que inicio iniciar.ps1 (los registra en %LOCALAPPDATA%\GaleCore\pids.json).
  -DryRun  muestra lo que detendria sin tocar nada.
#>
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $env:LOCALAPPDATA 'GaleCore\pids.json'

Write-Host ''
Write-Host 'Deteniendo GaleCore' -ForegroundColor White
if ($DryRun) { Write-Host '(modo simulacro: no se detiene nada)' -ForegroundColor Yellow }

if (-not (Test-Path $pidFile)) { Write-Host '  No hay nada iniciado por GaleCore.'; exit 0 }
$lista = @()
try { $lista = @(Get-Content $pidFile -Raw | ConvertFrom-Json) } catch { $lista = @() }

foreach ($r in $lista) {
    $p = Get-Process -Id $r.Pid -ErrorAction SilentlyContinue
    # El inicio debe coincidir: evita matar otro programa que reuso el mismo PID.
    if ($p -and ($p.StartTime.ToUniversalTime().ToString('o') -eq $r.Inicio)) {
        if ($DryRun) { Write-Host "  [simulacro] detendria $($r.Servicio) (PID $($r.Pid)) y sus procesos hijos" -ForegroundColor DarkGray }
        else {
            & taskkill.exe /PID $r.Pid /T /F | Out-Null
            Write-Host "  [ok] $($r.Servicio) detenido" -ForegroundColor Green
        }
    } else {
        Write-Host "  $($r.Servicio): ya no estaba corriendo"
    }
}
if (-not $DryRun) { Remove-Item $pidFile -Force }
