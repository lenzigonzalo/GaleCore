#Requires -Version 5.1
<#
.SYNOPSIS
    Publica DataFeed.Api en el VPS Linux: publish, empaquetado, transferencia y reinicio.

.DESCRIPTION
    Reemplaza los ocho comandos manuales del despliegue. Deliberadamente NO cuelga de un target
    de MSBuild: un target atado a `Publish` dispararia en todo publish -- incluido el de un CI --
    y dejaria la operacion que puede tumbar la API escondida dentro del .csproj.

    Lo que este script cuida y a mano se olvida:

    * Los EXCLUDES del empaquetado. `Files/` tiene archivos que la API escribe en runtime -- los
      switches de estrategia y skew25_history.json -- y extraer encima los pisa con los de esta
      maquina: las estrategias vuelven al estado del entorno local y la serie de skew se reemplaza
      por una que arrastra huecos. Lo que no viaja es lo que no se pisa.
    * Parar el servicio ANTES de extraer, para que el proceso no lea DLLs a medio escribir.
    * Sacar web.config (es de IIS, inerte en Linux) y appsettings.Development.json.
    * El tarball va a $env:TEMP y no al repo, para no dejar un artefacto de build sin trackear.

.PARAMETER SkipPublish
    Usa lo que ya haya en .\publish en vez de volver a compilar. Sirve cuando publicaste desde
    Visual Studio con FolderProfile, que escribe en esa misma carpeta.

.EXAMPLE
    .\deploy-api.ps1
    Despliegue completo desde cero.

.EXAMPLE
    .\deploy-api.ps1 -SkipPublish
    Despues de darle "Publicar" en Visual Studio.

.NOTES
    Pide la contrasena de sudo dos veces (ssh -t abre TTY para que sudo pueda preguntar). Para
    evitarlo hace falta una regla de sudoers acotada a los systemctl de este servicio -- es una
    decision aparte, no la toma este script.
#>
[CmdletBinding()]
param(
    [string] $Server     = 'elenzi@149.50.154.221',
    [string] $RemoteApp  = '/srv/galecore/app',
    [string] $Service    = 'galecore-datafeed',
    [string] $HealthUrl  = 'https://vps-6285555-x.dattaweb.com/swagger/v1/swagger.json',
    [switch] $SkipPublish
)

$ErrorActionPreference = 'Stop'

$project    = Join-Path $PSScriptRoot 'source\galecore-datafeed\DataFeed.Api\DataFeed.Api.csproj'
$publishDir = Join-Path $PSScriptRoot 'publish'
$tarball    = Join-Path $env:TEMP 'galecore-publish.tar.gz'
$remoteTar  = '~/galecore-publish.tar.gz'

function Step { param([string] $Text) Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Fail { param([string] $Text) Write-Host "`nFALLO: $Text" -ForegroundColor Red; exit 1 }

# ── 1. Publish ────────────────────────────────────────────────────────────────
if ($SkipPublish) {
    Step 'Publish omitido (-SkipPublish): se usa lo que ya hay en .\publish'
    if (-not (Test-Path (Join-Path $publishDir 'DataFeed.Api.dll'))) {
        Fail "No hay DataFeed.Api.dll en $publishDir. Publica primero, o corre sin -SkipPublish."
    }
} else {
    Step 'Compilando (Release, dependiente del framework)'
    dotnet publish $project -c Release -o $publishDir
    if ($LASTEXITCODE -ne 0) { Fail 'dotnet publish devolvio error.' }
}

# ── 2. Limpiar lo que no va al servidor ───────────────────────────────────────
Step 'Sacando web.config y appsettings.Development.json'
foreach ($f in @('web.config', 'appsettings.Development.json')) {
    $p = Join-Path $publishDir $f
    if (Test-Path $p) { Remove-Item $p -Force; Write-Host "    borrado: $f" }
}

# ── 3. Empaquetar preservando el estado del servidor ──────────────────────────
Step 'Empaquetando (sin los archivos de estado de runtime)'
if (Test-Path $tarball) { Remove-Item $tarball -Force }
tar -czf $tarball -C $publishDir `
    --exclude='./Files/*_switch_state.json' `
    --exclude='./Files/*/*_switch_state.json' `
    --exclude='./Files/skew25_history.json' `
    .
if ($LASTEXITCODE -ne 0) { Fail 'tar devolvio error.' }

# Si algun archivo de estado se colo, el deploy pisaria los switches del operador. Se para aca:
# es mas barato que descubrirlo cuando una estrategia amanecio apagada.
$colados = (tar -tzf $tarball) | Where-Object { $_ -match 'switch_state\.json|skew25_history\.json' }
if ($colados) { Fail "Los excludes no funcionaron. Se colaron:`n  $($colados -join "`n  ")" }

$mb = [math]::Round((Get-Item $tarball).Length / 1MB, 1)
Write-Host "    $tarball ($mb MB)"
Write-Host '    Files incluidos:'
(tar -tzf $tarball) | Where-Object { $_ -like '*Files/*json' } | ForEach-Object { Write-Host "      $_" }

# ── 4. Transferir ─────────────────────────────────────────────────────────────
Step "Subiendo a $Server"
scp $tarball "${Server}:$remoteTar"
if ($LASTEXITCODE -ne 0) { Fail 'scp devolvio error. Revisa la clave SSH y el firewall del panel.' }

# ── 5. Reemplazar y reiniciar ─────────────────────────────────────────────────
# -t abre TTY para que sudo pueda pedir la contrasena. El orden importa: parar antes de extraer.
Step 'Parando el servicio, extrayendo y volviendo a arrancar'
$remote = "sudo systemctl stop $Service" +
          " && sudo tar -xzf $remoteTar -C $RemoteApp" +
          " && sudo chown -R galecore:galecore $RemoteApp" +
          " && sudo systemctl start $Service"
ssh -t $Server $remote
if ($LASTEXITCODE -ne 0) { Fail 'El comando remoto devolvio error. La API puede haber quedado abajo.' }

# ── 6. Verificar ──────────────────────────────────────────────────────────────
Step 'Verificando que responda'
$ok = $false
for ($i = 1; $i -le 8; $i++) {
    try {
        $r = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 10
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch {
        Write-Host "    intento $i sin respuesta todavia..."
    }
    Start-Sleep -Seconds 5
}
if (-not $ok) {
    Write-Host "`nNo respondio 200 despues de 8 intentos. Mira los logs:" -ForegroundColor Yellow
    Write-Host "  ssh $Server 'sudo journalctl -u $Service -n 60 --no-pager'"
    exit 1
}

Step 'Estado de runtime en el servidor (las fechas tienen que ser ANTERIORES a este deploy)'
ssh $Server "ls -l $RemoteApp/Files/Gex/gex_switch_state.json $RemoteApp/Files/skew25_history.json"

Write-Host "`nDeploy OK. $HealthUrl responde 200." -ForegroundColor Green
