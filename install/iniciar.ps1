<#
.SYNOPSIS
  Inicia GaleCore: API (:7001), monitor (:3039), Lab (:8771) y el login de los motores (:8770, «Proveedores IA»),
  y abre el monitor en el navegador.
  -DryRun  muestra lo que haria sin iniciar nada.
  -NoAbrir no abre el navegador.
#>
param([switch]$DryRun, [switch]$NoAbrir)
$ErrorActionPreference = 'Stop'

function Ok($t)    { Write-Host "  [ok] $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Sim($t)   { Write-Host "  [simulacro] $t" -ForegroundColor DarkGray }
function Falla($t) { Write-Host "ERROR: $t" -ForegroundColor Red; exit 1 }

$raiz = Split-Path -Parent $PSScriptRoot
$app = Join-Path $raiz 'galecore-app'
$lab = Join-Path $raiz 'galecore-lab'
$venvScripts = Join-Path $raiz '.venv\Scripts'
$py = Join-Path $venvScripts 'python.exe'
$devPy = Join-Path $app 'dev\galecore_dev.py'
$envJson = Join-Path $app 'dev\.local\env.json'
$logs = Join-Path $env:LOCALAPPDATA 'GaleCore\logs'
$pidFile = Join-Path $env:LOCALAPPDATA 'GaleCore\pids.json'

$servicios = @(
    @{ Nombre = 'Lab';     Puerto = 8771; Espera = 60 },
    @{ Nombre = 'Motores'; Puerto = 8770; Espera = 60 },
    @{ Nombre = 'API';     Puerto = 7001; Espera = 240 },
    @{ Nombre = 'Monitor'; Puerto = 3039; Espera = 300 }
)

function Puerto-Escuchando([int]$p) {
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue)
}
function Leer-Pids {
    if (-not (Test-Path $pidFile)) { return @() }
    try { return @(Get-Content $pidFile -Raw | ConvertFrom-Json) } catch { return @() }
}
function Esta-Vivo($r) {
    $p = Get-Process -Id $r.Pid -ErrorAction SilentlyContinue
    return ($p -and ($p.StartTime.ToUniversalTime().ToString('o') -eq $r.Inicio))
}

Write-Host ''
Write-Host 'Iniciando GaleCore' -ForegroundColor White
if ($DryRun) { Write-Host '(modo simulacro: no se inicia nada)' -ForegroundColor Yellow }

if (-not (Test-Path $envJson)) {
    if ($DryRun) { Aviso "Falta la configuracion ($envJson): en una instalacion real la crea install\instalar.ps1." }
    else { Falla "Falta la configuracion ($envJson). Corre primero install\instalar.ps1." }
}
if (-not (Test-Path $py)) {
    if ($DryRun) { Aviso 'Falta el entorno de Python (.venv): en una instalacion real lo crea install\instalar.ps1.' }
    else { Falla 'Falta el entorno de Python (.venv). Corre primero install\instalar.ps1.' }
}

$propios = @(Leer-Pids | Where-Object { Esta-Vivo $_ })
if ($propios.Count -gt 0) {
    Aviso 'GaleCore ya esta iniciado.'
    if (-not $NoAbrir -and -not $DryRun) { Start-Process 'http://localhost:3039' }
    exit 0
}

# Un puerto ocupado por otro programa: no se pisa.
foreach ($s in $servicios) {
    if (Puerto-Escuchando $s.Puerto) {
        $msg = "El puerto $($s.Puerto) ($($s.Nombre)) ya esta ocupado por otro programa. Cerralo y volve a intentar."
        if ($DryRun) { Aviso $msg } else { Falla $msg }
    }
}

# Entorno: variables de usuario de Windows (las crea instalar.ps1) y el Python del proyecto primero en PATH.
foreach ($n in 'GALECORE_API_KEY', 'GALECORE_BASE_URL', 'GALECORE_USERNAME', 'GALECORE_PASSWORD', 'GALECORE_LAB_PROVIDER', 'GALECORE_TIMEOUT_SECONDS', 'ALLOW_UNKNOWN_FRESHNESS', 'MAX_STALENESS_SECONDS') {
    $v = [Environment]::GetEnvironmentVariable($n, 'User')
    if ($v) { [Environment]::SetEnvironmentVariable($n, $v, 'Process') }
}
if (-not $env:GALECORE_BASE_URL) { $env:GALECORE_BASE_URL = 'http://localhost:7001' }
if (-not $env:ALLOW_UNKNOWN_FRESHNESS) { $env:ALLOW_UNKNOWN_FRESHNESS = 'true' }
if (-not $env:MAX_STALENESS_SECONDS) { $env:MAX_STALENESS_SECONDS = '36000' }
if (-not $env:GALECORE_TIMEOUT_SECONDS) { $env:GALECORE_TIMEOUT_SECONDS = '300' }
$env:Path = "$venvScripts;$env:Path"
$claudeBin = Join-Path $env:USERPROFILE '.local\bin'
if ((Test-Path $claudeBin) -and ($env:Path -notlike "*$claudeBin*")) { $env:Path += ";$claudeBin" }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    if ($DryRun) { Aviso 'No encuentro Node.js: en una instalacion real lo instala install\instalar.ps1.' }
    else { Falla 'No encuentro Node.js. Corre install\instalar.ps1.' }
}
$nodeExe = 'node'
if ($node) { $nodeExe = $node.Source }

$comandos = @{
    'Lab'     = @{ Exe = $nodeExe; Args = 'lab-server.js'; Dir = $lab }
    'Motores' = @{ Exe = $nodeExe; Args = 'server.js'; Dir = $lab }   # login de Claude/Codex desde Proveedores IA
    'API'     = @{ Exe = $py; Args = ('"' + $devPy + '" api'); Dir = $raiz }
    'Monitor' = @{ Exe = $py; Args = ('"' + $devPy + '" monitor'); Dir = $raiz }
}

if ($DryRun) {
    foreach ($s in $servicios) {
        $c = $comandos[$s.Nombre]
        Sim "iniciaria $($s.Nombre) en :$($s.Puerto) (oculto): $($c.Exe) $($c.Args)  -> log en $logs\$($s.Nombre.ToLower()).log"
    }
    Sim 'esperaria a que respondan los tres puertos y abriria http://localhost:3039'
    Sim "guardaria los PID en $pidFile"
    exit 0
}

New-Item -ItemType Directory -Force -Path $logs | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pidFile) | Out-Null
$registro = @()
foreach ($s in $servicios) {
    $c = $comandos[$s.Nombre]
    $base = Join-Path $logs $s.Nombre.ToLower()
    $p = Start-Process -FilePath $c.Exe -ArgumentList $c.Args -WorkingDirectory $c.Dir -WindowStyle Hidden `
        -RedirectStandardOutput "$base.log" -RedirectStandardError "$base.err.log" -PassThru
    $registro += [pscustomobject]@{ Servicio = $s.Nombre; Pid = $p.Id; Inicio = $p.StartTime.ToUniversalTime().ToString('o') }
    ConvertTo-Json -InputObject @($registro) | Set-Content -Path $pidFile -Encoding UTF8
    Write-Host "  ... $($s.Nombre) arrancando (hasta $($s.Espera) s)"
    $limite = (Get-Date).AddSeconds($s.Espera)
    while (-not (Puerto-Escuchando $s.Puerto)) {
        if ($p.HasExited) { Falla "$($s.Nombre) se cerro al arrancar. Mira el detalle en $base.err.log y $base.log" }
        if ((Get-Date) -gt $limite) { Falla "$($s.Nombre) no respondio en $($s.Espera) s. Mira $base.err.log y $base.log" }
        Start-Sleep -Seconds 2
    }
    Ok "$($s.Nombre) listo en :$($s.Puerto)"
}

Write-Host ''
Write-Host '  GaleCore esta listo. Abriendo el monitor...' -ForegroundColor Green
if (-not $NoAbrir) { Start-Process 'http://localhost:3039' }
