<#
.SYNOPSIS
  Instala (o actualiza) GaleCore en esta PC: API local, monitor y Lab contra GaleCore Dev.
.DESCRIPTION
  Un solo comando; se puede volver a correr cuando quieras (actualiza lo que haga falta).
  -DryRun        muestra lo que haria, sin instalar ni cambiar nada.
  -Reconfigurar  vuelve a pedir los valores de conexion (por defecto se conservan los ya cargados).
  -Carpeta       donde queda el codigo (por defecto %USERPROFILE%\GaleCore).
#>
param(
    [switch]$DryRun,
    [switch]$Reconfigurar,
    [string]$Carpeta = '',
    [string]$Repo = 'https://github.com/lenzigonzalo/GaleCore.git',
    [string]$Rama = 'main'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

# ---------- utilidades ----------
function Titulo($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "  [ok] $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Sim($t)    { Write-Host "  [simulacro] $t" -ForegroundColor DarkGray }
function Falla($t)  { Write-Host ''; Write-Host "ERROR: $t" -ForegroundColor Red; exit 1 }

function Actualizar-Path {
    $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (($m, $u) | Where-Object { $_ }) -join ';'
    $local = Join-Path $env:USERPROFILE '.local\bin'
    if ((Test-Path $local) -and ($env:Path -notlike "*$local*")) { $env:Path += ";$local" }
}

function Tiene($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Ejecutar([string]$que, [scriptblock]$bloque) {
    if ($DryRun) { Sim $que; return }
    Write-Host "  ... $que"
    & $bloque
}

function Leer-Texto([string]$pregunta) {
    do { $v = (Read-Host "  $pregunta").Trim() } while (-not $v)
    return $v
}
function Leer-Secreto([string]$pregunta) {
    # Se escribe sin mostrarse; nunca se imprime ni se guarda en el historial de la consola.
    do {
        $s = Read-Host "  $pregunta (no se muestra)" -AsSecureString
        $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
        try { $v = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b).Trim() }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
    } while (-not $v)
    return $v
}
function Escribir-Utf8([string]$ruta, [string]$texto) {
    [IO.File]::WriteAllText($ruta, $texto, (New-Object Text.UTF8Encoding($false)))
}

Write-Host ''
Write-Host 'Instalador de GaleCore' -ForegroundColor White
if ($DryRun) { Write-Host '(modo simulacro: no se instala ni se cambia nada)' -ForegroundColor Yellow }

# ---------- carpeta de destino ----------
Titulo 'Carpeta'
$aquiRaiz = Split-Path -Parent $PSScriptRoot
$esClon = (Test-Path (Join-Path $aquiRaiz '.git')) -and (Test-Path (Join-Path $aquiRaiz 'galecore-app')) -and (Test-Path (Join-Path $aquiRaiz 'galecore-lab'))
if (-not $Carpeta) {
    if ($esClon) { $Carpeta = $aquiRaiz } else { $Carpeta = Join-Path $env:USERPROFILE 'GaleCore' }
}
$Carpeta = [IO.Path]::GetFullPath($Carpeta)
Ok "GaleCore va en $Carpeta"

# ---------- requisitos ----------
Titulo 'Requisitos'
Actualizar-Path
$tieneWinget = Tiene 'winget'

function Asegurar-Winget([string]$nombre, [string]$id, [bool]$yaEsta) {
    if ($yaEsta) { Ok "$nombre ya esta instalado"; return }
    if ($DryRun) { Sim "instalaria $nombre con winget ($id)"; return }
    if (-not $tieneWinget) { Falla "Falta $nombre y no encuentro winget. Actualiza 'App Installer' desde Microsoft Store y volve a correr este script." }
    Write-Host "  ... instalando $nombre (puede pedir permiso de administrador)"
    & winget install --id $id -e --silent --accept-source-agreements --accept-package-agreements
    Actualizar-Path
    Ok "$nombre instalado"
}

$tieneGit = Tiene 'git'
Asegurar-Winget 'Git' 'Git.Git' $tieneGit

$tieneDotnet = $false
if (Tiene 'dotnet') { $tieneDotnet = [bool]((& dotnet --list-sdks 2>$null) -match '^8\.') }
Asegurar-Winget '.NET 8 SDK' 'Microsoft.DotNet.SDK.8' $tieneDotnet

$tieneNode = $false
if (Tiene 'node') { $v = (& node -v) -replace '^v', ''; $tieneNode = ([int]($v.Split('.')[0]) -ge 20) }
Asegurar-Winget 'Node.js (LTS)' 'OpenJS.NodeJS.LTS' $tieneNode

$tienePython = $false
if (Tiene 'python') {
    $pv = (& python --version 2>&1 | Out-String)
    if ($pv -match 'Python 3\.(\d+)') { $tienePython = ([int]$Matches[1] -ge 11) }
}
Asegurar-Winget 'Python 3.12' 'Python.Python.3.12' $tienePython

# Claude Code (el motor). Metodo oficial de Anthropic; si falla, npm.
$tieneClaude = (Tiene 'claude') -or (Test-Path (Join-Path $env:USERPROFILE '.local\bin\claude.exe'))
if ($tieneClaude) { Ok 'Claude Code ya esta instalado' }
elseif ($DryRun) { Sim 'instalaria Claude Code (irm https://claude.ai/install.ps1 | iex; si falla, npm i -g @anthropic-ai/claude-code)' }
else {
    Write-Host '  ... instalando Claude Code'
    try { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression } catch { Aviso "El instalador oficial fallo ($($_.Exception.Message)); pruebo con npm." }
    Actualizar-Path
    if (-not ((Tiene 'claude') -or (Test-Path (Join-Path $env:USERPROFILE '.local\bin\claude.exe')))) {
        & npm install -g '@anthropic-ai/claude-code'
        Actualizar-Path
    }
    if ((Tiene 'claude') -or (Test-Path (Join-Path $env:USERPROFILE '.local\bin\claude.exe'))) { Ok 'Claude Code instalado' }
    else { Aviso 'No pude instalar Claude Code. Instalalo a mano (https://claude.ai/download) y volve a correr este script.' }
}

if (-not $DryRun) {
    foreach ($c in 'git', 'dotnet', 'node', 'npm', 'python') {
        if (-not (Tiene $c)) { Falla "Instale '$c' pero esta ventana todavia no lo ve. Cerra esta ventana, abri otra de PowerShell y volve a correr el script." }
    }
}

# ---------- codigo ----------
Titulo 'Codigo de GaleCore'
if (Test-Path (Join-Path $Carpeta '.git')) {
    Ejecutar "actualizar $Carpeta (git pull)" {
        & git -C $Carpeta fetch origin
        & git -C $Carpeta checkout $Rama
        & git -C $Carpeta pull --ff-only origin $Rama
        if ($LASTEXITCODE -ne 0) { Falla 'No pude actualizar: hay cambios locales en la carpeta. Avisale a Gonzalo.' }
        Ok 'codigo al dia'
    }
} else {
    if ((Test-Path $Carpeta) -and (Get-ChildItem $Carpeta -Force | Select-Object -First 1)) {
        if ($DryRun) { Sim "la carpeta $Carpeta existe y no es GaleCore: preguntaria otra carpeta" }
        else {
            Aviso "La carpeta $Carpeta existe y no es una instalacion de GaleCore."
            $Carpeta = [IO.Path]::GetFullPath((Leer-Texto 'Otra carpeta donde instalar (ej. C:\GaleCore)'))
            if ((Test-Path $Carpeta) -and (Get-ChildItem $Carpeta -Force | Select-Object -First 1)) { Falla "$Carpeta tampoco esta vacia." }
        }
    }
    Ejecutar "clonar $Repo en $Carpeta (si pide usuario, entra con tu cuenta de GitHub)" {
        & git clone --branch $Rama $Repo $Carpeta
        if ($LASTEXITCODE -ne 0) { Falla 'No pude clonar el repositorio. Verifica que Gonzalo te dio acceso en GitHub y que iniciaste sesion cuando Git lo pidio.' }
        Ok 'codigo descargado'
    }
}

$ai   = Join-Path $Carpeta 'galecore-ai'
$lab  = Join-Path $Carpeta 'galecore-lab'
$app  = Join-Path $Carpeta 'galecore-app'
$mon  = Join-Path $app 'source\galecore-monitor'
$feed = Join-Path $app 'source\galecore-datafeed'
$apiCsproj = Join-Path $feed 'DataFeed.Api\DataFeed.Api.csproj'
$venv = Join-Path $Carpeta '.venv'
$envJson = Join-Path $app 'dev\.local\env.json'

# ---------- dependencias ----------
Titulo 'Dependencias'
Ejecutar 'Python: entorno virtual (.venv) y paquetes de galecore-ai/' {
    if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) { & python -m venv $venv }
    & (Join-Path $venv 'Scripts\python.exe') -m pip install --quiet --disable-pip-version-check -e $ai
    if ($LASTEXITCODE -ne 0) { Falla 'Fallo la instalacion de los paquetes de Python.' }
    Ok 'Python listo'
}
foreach ($dir in @($lab, $mon)) {
    Ejecutar "npm ci en $dir (solo si cambio package-lock.json)" {
        $lock = Join-Path $dir 'package-lock.json'
        $marca = Join-Path $dir 'node_modules\.package-lock.json'
        if ((-not (Test-Path $marca)) -or ((Get-Item $lock).LastWriteTime -gt (Get-Item $marca).LastWriteTime)) {
            Push-Location $dir
            try { & npm.cmd ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { Falla "npm ci fallo en $dir" } } finally { Pop-Location }
        }
        Ok "$(Split-Path -Leaf $dir) listo"
    }
}
Ejecutar '.NET: restore y build de la API' {
    & dotnet restore $apiCsproj --nologo -v q
    if ($LASTEXITCODE -ne 0) { Falla 'dotnet restore fallo.' }
    & dotnet build $apiCsproj --no-restore --nologo -v q
    if ($LASTEXITCODE -ne 0) { Falla 'dotnet build fallo.' }
    Ok 'API compilada'
}

# ---------- configuracion local ----------
Titulo 'Configuracion de conexion a GaleCore Dev'
$devPy = Join-Path $app 'dev\galecore_dev.py'
$ref = 'ecymbgpimqbtcvqyjtaq'
if (Test-Path $devPy) {
    $m = [regex]::Match((Get-Content $devPy -Raw), 'DEV_PROJECT_REF\s*=\s*"([a-z0-9]+)"')
    if ($m.Success) { $ref = $m.Groups[1].Value }
}
$supabaseUrl = "https://$ref.supabase.co"

if ($DryRun) {
    $existe = Test-Path $envJson
    Sim "$(if ($existe) { 'conservaria' } else { 'crearia' }) $envJson (pediria: anon key, host del pooler, contrasena de la base galecore_api)"
    Sim 'pediria tus credenciales de Tastytrade (refresh token y client secret) y las guardaria con dotnet user-secrets'
    Sim 'pediria tu usuario y contrasena de GaleCore Dev y los guardaria como variables de usuario (GALECORE_USERNAME / GALECORE_PASSWORD)'
    Sim 'generaria una ApiKey local (user-secrets de la API + variable de usuario GALECORE_API_KEY) y fijaria GALECORE_BASE_URL=http://localhost:7001'
    Sim 'dejaria SHADOW y RPF apagados: runtime_persistence=false en env.json + Files/Rpf/rpf_switch_state.json y Files/platform_services_switch_state.json con enabled=false'
} else {
    $cfg = [ordered]@{}
    if (Test-Path $envJson) {
        $prev = Get-Content $envJson -Raw | ConvertFrom-Json
        foreach ($p in $prev.PSObject.Properties) { $cfg[$p.Name] = $p.Value }
    }
    $tocaPedir = $Reconfigurar -or -not ($cfg.Contains('anon_key') -and $cfg.Contains('pooler_host') -and $cfg.Contains('api_password'))
    if ($tocaPedir) {
        Write-Host '  Estos datos te los pasa Gonzalo por un canal seguro. Pegalos cuando se pidan.'
        do { $anon = Leer-Texto 'Clave publica (anon key) de GaleCore Dev' } while ($anon -notmatch '^eyJ')
        do { $pooler = Leer-Texto 'Host del pooler (termina en pooler.supabase.com)' } while ($pooler -notmatch 'pooler\.supabase\.com$')
        $cfg['supabase_url'] = $supabaseUrl
        $cfg['project_ref'] = $ref
        $cfg['anon_key'] = $anon
        $cfg['pooler_host'] = $pooler
        $cfg['api_password'] = Leer-Secreto 'Contrasena de la base (rol galecore_api)'
    } else { Ok 'conexion a Dev ya configurada (usa -Reconfigurar para cambiarla)' }
    # SHADOW apagado en esta API: no recupera ni valua las instancias del owner y no puede desplegar.
    $cfg['runtime_persistence'] = $false
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $envJson) | Out-Null
    Escribir-Utf8 $envJson (($cfg | ConvertTo-Json -Depth 4))
    Ok "guardado $envJson (queda fuera de git)"

    # Credenciales de Tastytrade (datos de mercado) y ApiKey local: user-secrets de la API.
    $listado = ''
    try { $listado = (& dotnet user-secrets list --project $apiCsproj 2>$null | Out-String) } catch { $listado = '' }
    $tieneTt = ($listado -match '(?m)^Tastytrade:OAuth:refresh_token\s*=') -and ($listado -match '(?m)^Tastytrade:OAuth:client_secret\s*=')
    if ($Reconfigurar -or -not $tieneTt) {
        Write-Host '  Tus credenciales de Tastytrade (aplicacion OAuth propia: refresh token y client secret).'
        $rt = Leer-Secreto 'Tastytrade refresh token'
        $cs = Leer-Secreto 'Tastytrade client secret'
        & dotnet user-secrets set 'Tastytrade:OAuth:refresh_token' $rt --project $apiCsproj | Out-Null
        & dotnet user-secrets set 'Tastytrade:OAuth:client_secret' $cs --project $apiCsproj | Out-Null
        $rt = $null; $cs = $null
        Ok 'credenciales de Tastytrade guardadas en user-secrets'
    } else { Ok 'credenciales de Tastytrade ya cargadas' }

    $tieneKeySecret = $listado -match '(?m)^ApiKey\s*='
    $tieneKeyEnv = [bool][Environment]::GetEnvironmentVariable('GALECORE_API_KEY', 'User')
    if ($Reconfigurar -or -not ($tieneKeySecret -and $tieneKeyEnv)) {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $key = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
        & dotnet user-secrets set 'ApiKey' $key --project $apiCsproj | Out-Null
        [Environment]::SetEnvironmentVariable('GALECORE_API_KEY', $key, 'User')
        $key = $null
        Ok 'ApiKey local generada (solo vive en esta PC)'
    } else { Ok 'ApiKey local ya existe' }
    [Environment]::SetEnvironmentVariable('GALECORE_BASE_URL', 'http://localhost:7001', 'User')

    # Usuario de GaleCore Dev: lo usan el Lab y el harness para entrar como vos.
    $tieneUsr = [bool][Environment]::GetEnvironmentVariable('GALECORE_USERNAME', 'User') -and [bool][Environment]::GetEnvironmentVariable('GALECORE_PASSWORD', 'User')
    if ($Reconfigurar -or -not $tieneUsr) {
        Write-Host '  Tu usuario de GaleCore Dev (el que te creo Gonzalo). Es el mismo con el que entras al monitor.'
        [Environment]::SetEnvironmentVariable('GALECORE_USERNAME', (Leer-Texto 'Usuario'), 'User')
        [Environment]::SetEnvironmentVariable('GALECORE_PASSWORD', (Leer-Secreto 'Contrasena'), 'User')
        Ok 'usuario guardado como variable de usuario de Windows'
    } else { Ok 'usuario de Dev ya configurado' }

    # SHADOW y RPF apagados (archivos de estado locales, ignorados por git).
    $files = Join-Path $feed 'DataFeed.Api\Files'
    $ahora = (Get-Date).ToUniversalTime().ToString('o')
    New-Item -ItemType Directory -Force -Path (Join-Path $files 'Rpf') | Out-Null
    Escribir-Utf8 (Join-Path $files 'Rpf\rpf_switch_state.json') (([ordered]@{ enabled = $false; updatedAt = $ahora }) | ConvertTo-Json)
    $plataforma = Join-Path $files 'platform_services_switch_state.json'
    $estado = [ordered]@{}
    if (Test-Path $plataforma) {
        try { foreach ($p in (Get-Content $plataforma -Raw | ConvertFrom-Json).PSObject.Properties) { $estado[$p.Name] = $p.Value } } catch { $estado = [ordered]@{} }
    }
    $estado['runtime'] = [ordered]@{ enabled = $false; updatedAt = $ahora }
    Escribir-Utf8 $plataforma ($estado | ConvertTo-Json -Depth 4)
    Ok 'SHADOW y RPF quedan apagados en tu API'
}

# ---------- accesos directos ----------
Titulo 'Accesos directos'
$iniciar = Join-Path $Carpeta 'install\iniciar.ps1'
$detener = Join-Path $Carpeta 'install\detener.ps1'
function Nuevo-Acceso([string]$ruta, [string]$script, [string]$estilo) {
    $sh = New-Object -ComObject WScript.Shell
    $l = $sh.CreateShortcut($ruta)
    $l.TargetPath = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
    $l.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle $estilo -File `"$script`""
    $l.WorkingDirectory = $Carpeta
    $l.Description = 'GaleCore'
    $l.Save()
}
$escritorio = [Environment]::GetFolderPath('Desktop')
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'GaleCore'
Ejecutar "crear accesos 'GaleCore' (escritorio y menu Inicio) y 'Detener GaleCore' (menu Inicio)" {
    New-Item -ItemType Directory -Force -Path $menu | Out-Null
    Nuevo-Acceso (Join-Path $escritorio 'GaleCore.lnk') $iniciar 'Hidden'
    Nuevo-Acceso (Join-Path $menu 'GaleCore.lnk') $iniciar 'Hidden'
    Nuevo-Acceso (Join-Path $menu 'Detener GaleCore.lnk') $detener 'Hidden'
    Ok 'accesos creados'
}

Titulo 'Listo'
if ($DryRun) { Write-Host '  Simulacro terminado: no se cambio nada.' }
else {
    Write-Host '  Para empezar: abri el acceso "GaleCore" del escritorio.'
    Write-Host '  La primera vez, abri una terminal y escribi `claude` para iniciar sesion con tu suscripcion.'
    Write-Host '  Para actualizar mas adelante, volve a correr este mismo script.'
}
