#Requires -Version 5.1
<#
.SYNOPSIS
    Corrida de captura del 2026-08-25 con BOOK VIVO, para cerrar el pendiente de la seccion 43.4.

.DESCRIPTION
    Toda la evidencia de SPY y QQQ del v5 se capturo POST-CIERRE (~17:25 y ~18:15 ET del 24-ago),
    asi que la tabla de sesgo por lado de la 43.4 -- CALL/PUT 1.81 en SPY, 1.57 en QQQ, 0.65 en
    TSLA -- todavia no esta confirmada con el book abierto. Esto es esa recaptura.

    Que cambia respecto de la tanda del 24:

    * Los DOS vencimientos son REGULARES y son los del bucle real de la 47.1 (2026-09-18 y
      2026-10-16). El 2026-09-04 de la tanda anterior es un weekly y queda afuera.
    * TSLA entra como control de superficie invertida (43.5), tambien sobre el 09-18, que no tenia.
    * Los mismos parametros que la tanda anterior -- -WithQuotes -SpreadWidth 5 -QuoteBandPct 12 --
      para que la comparacion sea contra lo mismo y la unica variable sea el horario.

    Y arregla dos cosas que a mano se pierden:

    * EL ENCABEZADO NO SE GUARDA. Spot, ATM IV, muros, ZGL y DTE los imprime gex-strikes.ps1 en
      pantalla y no van al CSV (data/README.md lo advierte, y recheck_econ.py los tiene hardcodeados
      por eso). Aca cada captura queda logueada entera en su .txt.
    * EL HORARIO DE CAPTURA ES EL DATO EN DISPUTA. capturas.txt registra inicio y fin de cada una
      en hora local Y en ET, que es contra la que se dice "en sesion".

    UNA PASADA DE CADENA POR SIMBOLO. Los dos vencimientos salen de la MISMA respuesta de
    /App/Gex/Analysis, asi que solo la primera captura de cada simbolo va con -Refresh; la segunda
    reusa el cache de 600s. Ahorra ~2.5 min por simbolo y ademas deja los dos vencimientos sobre
    la misma foto de estructura. Si el cache expiro, la segunda barre de nuevo sola: mas lenta,
    nunca incorrecta.

.PARAMETER At
    Hora local a la que arranca. Default 11:00 (10:00 ET, media hora despues de la apertura: el
    book ya se asento y quedan cuatro horas de sesion por delante). Pasar -Now para ir ya.

.PARAMETER PreflightOnly
    Corre solo las verificaciones y termina. Es lo que conviene correr ANTES de las 11:00.

.EXAMPLE
    .\capturar_2026-08-25.ps1 -PreflightOnly
    .\capturar_2026-08-25.ps1
#>
param(
    [string] $At           = '11:00',
    [switch] $Now,
    [switch] $PreflightOnly,
    [string] $BaseUrl      = 'http://localhost:7001',
    [string] $ApiKey,
    [string] $RepoRoot
)

$ErrorActionPreference = 'Stop'

$SYMBOLS     = @('SPY', 'QQQ', 'TSLA')
$EXPIRATIONS = @('2026-09-18', '2026-10-16')   # los dos regulares del bucle, mirando desde el 25-ago
$FECHA       = '2026-08-25'

function Step { param([string] $t) Write-Host "`n==> $t" -ForegroundColor Cyan }
function Fail { param([string] $t) Write-Host "`nFALLO: $t" -ForegroundColor Red; exit 1 }
function Warn { param([string] $t) Write-Host "AVISO: $t" -ForegroundColor Yellow }
function Ok   { param([string] $t) Write-Host "  ok  $t" -ForegroundColor Green }

# ── Raiz del repo ─────────────────────────────────────────────────────────────
# Se resuelve caminando para arriba hasta encontrar el script de captura, para que esto siga
# andando si el archivo se mueve a research\got\scripts\.
if (-not $RepoRoot) {
    $d = $PSScriptRoot
    while ($d -and -not (Test-Path (Join-Path $d 'research\gex-strikes.ps1'))) { $d = Split-Path $d -Parent }
    $RepoRoot = if ($d) { $d } else { 'C:\Eric\App\Claude\Projects\GaleCore' }
}
$capturar = Join-Path $RepoRoot 'research\gex-strikes.ps1'
if (-not (Test-Path $capturar)) { Fail "No encuentro research\gex-strikes.ps1 bajo $RepoRoot. Pasa -RepoRoot." }
$outDir = Join-Path $RepoRoot "research\got\data\$FECHA"

# ── Hora ET ───────────────────────────────────────────────────────────────────
# La maquina esta en ART y el mercado en ET; en agosto es EDT. Se convierte de verdad en vez de
# restar una hora a mano, que en noviembre daria un dato falso en el registro.
$tzEt = [System.TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
function EtNow { [System.TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $tzEt) }
function Sello { param([datetime] $t) '{0:HH:mm:ss} local / {1:HH:mm:ss} ET' -f $t, ([System.TimeZoneInfo]::ConvertTimeFromUtc($t.ToUniversalTime(), $tzEt)) }

# ══════════════════════════════════════════════════════════════════════════════
#  PREFLIGHT
# ══════════════════════════════════════════════════════════════════════════════
Step 'Preflight'

# 1. Credencial. Misma cadena de resolucion que gex-strikes.ps1 -- se repite a proposito para
#    poder fallar ACA, con el mercado todavia cerrado, y no en el minuto de la corrida.
if (-not $ApiKey) { $ApiKey = $env:GALECORE_API_KEY }
if (-not $ApiKey) {
    $csproj = Join-Path $RepoRoot 'source\galecore-datafeed\DataFeed.Api\DataFeed.Api.csproj'
    if (Test-Path $csproj) {
        $id = ([xml](Get-Content $csproj -Raw)).Project.PropertyGroup.UserSecretsId | Where-Object { $_ }
        $secrets = Join-Path $env:APPDATA "Microsoft\UserSecrets\$id\secrets.json"
        if ($id -and (Test-Path $secrets)) { $ApiKey = (Get-Content $secrets -Raw | ConvertFrom-Json).ApiKey }
    }
}
if (-not $ApiKey) { Fail 'Sin ApiKey. Defini $env:GALECORE_API_KEY o pasa -ApiKey.' }
Ok 'ApiKey resuelta'

$hdr = @{ 'X-API-KEY' = $ApiKey }

# 2. La API responde.
try { $rules = Invoke-RestMethod -Uri "$BaseUrl/App/Gex/Rules" -Headers $hdr -TimeoutSec 20 }
catch { Fail "La API no responde en $BaseUrl. Levantala en Visual Studio antes de la corrida. $($_.Exception.Message)" }
Ok "API viva en $BaseUrl"

# 3. El universo del JSON QUE SIRVE LA API CORRIENDO. No alcanza con mirar el archivo del repo:
#    los JSON se copian al output al compilar, asi que una API levantada antes de editar
#    galecore_rules_gex.json sigue sirviendo el universo viejo -- y TSLA responderia error recien
#    despues de que uno se sento a esperar el barrido.
$tickers = @($rules.universe.tickers)
Write-Host "      universe.tickers = $($tickers -join ', ')"
$faltan = $SYMBOLS | Where-Object { $_ -notin $tickers }
if ($faltan) {
    Fail ("La API corriendo NO tiene {0} en universe.tickers. Recompila y reinicia la API para que tome el JSON editado (galecore_rules_gex.json quedo en SPY/QQQ/TSLA sin commitear)." -f ($faltan -join ', '))
}
Ok 'Los tres simbolos estan en el universo'

# 4. El switch de GEX. En OFF el barrido responde 409 y la corrida entera se cae.
try {
    $sw = Invoke-RestMethod -Uri "$BaseUrl/App/Gex/Switch" -Headers $hdr -TimeoutSec 20
    if (-not $sw.enabled) { Fail 'La estrategia GEX esta APAGADA. Prendela desde Main o con POST /App/Gex/Switch.' }
    Ok "GEX en ON (source: $($sw.source))"
} catch {
    if ($_.Exception.Message -match 'FALLO') { throw }
    Warn "No pude leer /App/Gex/Switch: $($_.Exception.Message). Si esta en OFF, la primera captura va a fallar con 409."
}

# 5. Los dos vencimientos son terceros viernes. gex-strikes.ps1 tambien avisa, pero recien despues
#    del barrido -- y el error que este preflight busca es justo el del hallazgo del weekly.
foreach ($e in $EXPIRATIONS) {
    $f = [datetime]::ParseExact($e, 'yyyy-MM-dd', $null)
    # Viernes es 5 en System.DayOfWeek (domingo = 0). NO es el 4 de weekday() de Python, que es el
    # que usa vencimientos_regulares.py -- misma cuenta, dos convenciones, y con el 4 este chequeo
    # daba el jueves y reprobaba el 2026-09-18, que es regular.
    $primero = [datetime]::new($f.Year, $f.Month, 1)
    $tercerViernes = $primero.AddDays(((5 - [int]$primero.DayOfWeek + 7) % 7) + 14)
    if ($f.Date -ne $tercerViernes.Date) { Fail "$e NO es el tercer viernes de su mes ($($tercerViernes.ToString('yyyy-MM-dd'))): es un weekly y queda fuera del bucle de la 47.1." }
    Ok "$e es regular (DTE $([int]($f.Date - (Get-Date).Date).TotalDays))"
}

# 6. Carpeta de salida.
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$yaHay = @(Get-ChildItem $outDir -Filter '*.csv' -ErrorAction SilentlyContinue)
if ($yaHay) { Warn "La carpeta ya tiene $($yaHay.Count) CSV. Un vencimiento repetido SE PISA -- el nombre del archivo no lleva la hora." }
Ok "Salida: $outDir"

Write-Host "`n      Plan: $($SYMBOLS.Count) simbolos x $($EXPIRATIONS.Count) vencimientos = $($SYMBOLS.Count * $EXPIRATIONS.Count) capturas, ~4 min cada una (~25 min en total)."
Write-Host "      Ahora son $(Sello (Get-Date)).  Mercado 09:30-16:00 ET."

if ($PreflightOnly) { Step 'Preflight OK. Nada capturado (-PreflightOnly).'; exit 0 }

# ══════════════════════════════════════════════════════════════════════════════
#  ESPERA
# ══════════════════════════════════════════════════════════════════════════════
if (-not $Now) {
    $target = [datetime]::Today.Add([timespan]::Parse($At))
    if ((Get-Date) -lt $target) {
        Step "Esperando hasta las $At local ($(Sello $target))"
        # Un aviso por minuto y no una cuenta regresiva con `r: el retorno de carro solo pisa la
        # linea en una consola de verdad. Corriendo en background cada tick queda como una linea
        # propia, y la espera sola escribe cientos antes de la primera captura.
        while ((Get-Date) -lt $target) {
            $resta = $target - (Get-Date)
            if ($resta.TotalSeconds -gt 90) {
                Write-Host ("    faltan {0:hh\:mm\:ss}" -f $resta) -ForegroundColor DarkGray
                Start-Sleep -Seconds 60
            } else {
                Start-Sleep -Seconds ([math]::Max(1, [int]$resta.TotalSeconds))
            }
        }
    }
}

$etAhora = EtNow
if ($etAhora.Hour -lt 9 -or ($etAhora.Hour -eq 9 -and $etAhora.Minute -lt 30) -or $etAhora.Hour -ge 16) {
    Warn "Son las $($etAhora.ToString('HH:mm')) ET: el mercado esta CERRADO. Esta corrida existe justamente para capturar con book vivo."
    $r = Read-Host '    Seguir igual? (s/N)'
    if ($r -ne 's') { Fail 'Cancelado.' }
}

# ══════════════════════════════════════════════════════════════════════════════
#  CAPTURAS
# ══════════════════════════════════════════════════════════════════════════════
$registro = Join-Path $outDir 'capturas.txt'
"# Corrida $FECHA -- book vivo, para el pendiente de la seccion 43.4" | Set-Content $registro -Encoding utf8
"# simbolo  vencimiento  inicio                          fin                             estado" | Add-Content $registro -Encoding utf8

$fallidas = @()
foreach ($sym in $SYMBOLS) {
    $primera = $true
    foreach ($exp in $EXPIRATIONS) {
        $t0 = Get-Date
        Step "$sym $exp  --  $(Sello $t0)$(if ($primera) { '  (barrido nuevo)' } else { '  (cache del barrido anterior)' })"

        $log = Join-Path $outDir "log_${sym}_$exp.txt"
        $paramsCaptura = @{
            Symbol       = $sym
            Expiration   = $exp
            BaseUrl      = $BaseUrl
            ApiKey       = $ApiKey
            WithQuotes   = $true
            SpreadWidth  = 5
            QuoteBandPct = 12
            OutDir       = $outDir
        }
        if ($primera) { $paramsCaptura['Refresh'] = $true }

        # 6>&1 porque gex-strikes.ps1 escribe con Write-Host, que va al stream de Information y no
        # al de salida: sin esto el log queda vacio y el encabezado se pierde otra vez.
        #
        # Y NO se usa Tee-Object, que seria lo natural: en PS 5.1 escribe UTF-16 y no acepta
        # -Encoding (llego en PS 6). El log salia en un encoding distinto al de los CSV de al lado,
        # que son UTF-8, y grep o csv de Python no lo leian -- un log que hay que abrir con la
        # herramienta correcta para descubrir que si tenia el dato. El ForEach hace las dos cosas:
        # Write-Host mantiene el avance en vivo durante los tres minutos de barrido, y lo que pasa
        # de largo lo escribe Out-File en UTF-8.
        & $capturar @paramsCaptura 6>&1 | ForEach-Object { Write-Host $_; $_ } |
            Out-File -FilePath $log -Encoding utf8

        # El exito se decide por el CSV, no por $LASTEXITCODE. Esa variable la setean los
        # ejecutables nativos y los `exit` explicitos; un .ps1 que termina normal la deja como
        # estaba -- vacia en la primera vuelta -- y `$null -eq 0` es falso, asi que las cuatro
        # primeras capturas de esta misma corrida quedaron registradas como FALLO estando bien.
        # El archivo escrito y con fecha posterior al arranque es el hecho; el codigo de salida
        # era el sintoma, y encima uno que no existia.
        $csvEsperado = Join-Path $outDir ("{0}_gex_{1}.csv" -f $sym.ToUpper(), $exp)
        $ok = (Test-Path $csvEsperado) -and ((Get-Item $csvEsperado).LastWriteTime -ge $t0)
        $estado = if ($ok) { 'ok' } else { 'FALLO -- no escribio el CSV (ver el log)' }
        if (-not $ok) { $fallidas += "$sym $exp" }

        $t1 = Get-Date
        ('{0,-8} {1}  {2}  {3}  {4}  ({5:N0}s)' -f $sym, $exp, (Sello $t0), (Sello $t1), $estado, ($t1 - $t0).TotalSeconds) |
            Add-Content $registro -Encoding utf8
        $primera = $false
    }
}

# ══════════════════════════════════════════════════════════════════════════════
#  CIERRE
# ══════════════════════════════════════════════════════════════════════════════
Step 'Resultado'
foreach ($f in (Get-ChildItem $outDir -Filter '*.csv' | Sort-Object Name)) {
    $filas = (Get-Content $f.FullName | Measure-Object -Line).Lines - 1
    $tipo  = ((Get-Content $f.FullName -TotalCount 2)[1] -split ',')[-1]
    Write-Host ('    {0,-28} {1,5} strikes   {2}' -f $f.Name, $filas, $tipo)
}
Write-Host "`n    Registro de horarios: $registro"
if ($fallidas) { Warn ("Fallaron: {0}" -f ($fallidas -join ', ')) }

Write-Host "`n    Siguiente paso: el skew por lado sobre esta tanda, contra la tabla de la 43.4" -ForegroundColor DarkGray
Write-Host "      python research\got\scripts\skew_por_lado.py $FECHA" -ForegroundColor DarkGray
Write-Host "      (sin argumento toma la carpeta mas reciente, que ya es esta; se pasa igual para" -ForegroundColor DarkGray
Write-Host "       dejar por escrito sobre que se corrio, y 2026-08-24 da la tanda post-cierre)" -ForegroundColor DarkGray
