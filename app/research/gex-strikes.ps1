#Requires -Version 5.1
<#
.SYNOPSIS
    Tabla de GEX call / put por strike para un simbolo y un vencimiento, desde /App/Gex/Analysis.

.DESCRIPTION
    Captura los MISMOS datos con los que el tablero dibuja las barras de gamma de la pestana GEX.
    El grafico de la derecha se arma con dos fuentes: las velas (/Data/.../Candle) y los strikes de
    /App/Gex/Analysis. Este script trae la segunda, que es la que tiene el GEX por strike.

    Lo que resuelve y a mano se olvida:

    * El DTE pedido casi nunca existe. La cadena tiene los vencimientos que tiene (0, 3, 4... 42, 56),
      asi que el script elige el MAS CERCANO al -Dte pedido y avisa en pantalla con cuanta diferencia.
      Pedir 43 y recibir 42 sin que nadie lo diga es la forma facil de comparar dos scopes distintos.
    * El TIPO de vencimiento no se deduce de la fecha ni del DTE, y cambia lo que la captura significa.
      La cadena trae Regular (el mensual, tercer viernes) y Weekly mezclados -- asi lo pide el JSON de
      GEX -- y hasta agosto de 2026 ni el nombre del archivo ni el CSV lo decian: medio research de GOT
      quedo construido sobre un weekly sin que nadie se enterara. Ver
      research\got\hallazgos\2026-08-24-el-4-sep-es-un-weekly.md. Ahora sale en el encabezado, va como
      columna del CSV, y si no es Regular el script avisa ANTES del barrido de quotes.
    * Las UNIDADES no son las mismas en los dos niveles. Los strikes vienen en millones de USD por 1%
      de movimiento; el netGex del vencimiento, en miles de millones. El encabezado del CSV lo dice
      (`_musd`) para que la columna no se lea como el numero del panel.
    * El CSV sale con punto decimal (cultura invariante) y no con la coma del locale, para que lo
      pueda leer cualquier cosa que lo procese despues.
    * El barrido de la cadena tarda minutos la primera vez (148s medidos en QQQ). El timeout va en
      600s a proposito: el default de Invoke-RestMethod cortaria antes que el backend.

    NO levanta la API: si no responde, lo dice y termina. Levantarla es una decision del operador
    (Visual Studio, `dotnet run`, o apuntar -BaseUrl a produccion).

.PARAMETER Symbol
    Simbolo a barrer. Tiene que estar en `universe.tickers` del JSON de GEX; si no, la API responde
    con error y el script lo muestra tal cual.

.PARAMETER Dte
    DTE objetivo. Se usa el vencimiento mas cercano de la cadena, no uno exacto.

.PARAMETER Expiration
    Fecha exacta del vencimiento (yyyy-MM-dd), alternativa a -Dte. Si esa fecha no esta en la
    cadena, falla en vez de elegir la vecina.

.PARAMETER WithQuotes
    Agrega bid/ask de la call y de la put de cada strike. El GEX no los trae -- se calcula con
    gamma y OI, no con el book --, asi que salen de /Data/.../Quote: 2 requests por strike,
    ~0.2s cada uno.

.PARAMETER SpreadWidth
    Ancho en dolares del vertical cuyo credito se calcula por strike (0 = no calcular). Toma los
    dos legs de la misma cadena y usa bid del short contra ask del long, que es el peor caso
    ejecutable y no el mid. Requiere -WithQuotes.

.PARAMETER QuoteBandPct
    Acota el bid/ask a una banda de +-N% alrededor del spot (0 = toda la cadena). Fuera de la
    banda las celdas quedan vacias.

.PARAMETER BaseUrl
    Raiz de la API. Por defecto la local; para produccion, https://vps-6285555-x.dattaweb.com
    (que usa OTRA ApiKey -- la del VPS, no la de user-secrets de esta maquina).

.PARAMETER ApiKey
    Si no se pasa, sale de $env:GALECORE_API_KEY y, como ultimo recurso, de los user-secrets de
    DataFeed.Api en esta maquina.

.PARAMETER Refresh
    Fuerza un barrido nuevo de la cadena en vez de usar el cache del handler. Es lo caro.

.PARAMETER MinAbsNet
    Piso de |netGEX| (en millones) para la tabla que se imprime. El CSV SIEMPRE lleva todos los
    strikes: el filtro es de lectura, no de captura.

.PARAMETER OutDir
    Donde escribir el CSV. Por defecto $env:TEMP y no el repo, para no dejar capturas sin trackear.

.EXAMPLE
    .\research\gex-strikes.ps1 -Symbol QQQ -Dte 43
    Vencimiento mas cercano a 43 dias, contra la API local, usando el cache si esta caliente.

.EXAMPLE
    .\research\gex-strikes.ps1 -Symbol SPY -Dte 30 -Refresh -MinAbsNet 50
    Rebarre la cadena y muestra solo los strikes con |net| >= 50 M.

.EXAMPLE
    .\research\gex-strikes.ps1 -Symbol TSLA -Expiration 2026-10-16 -WithQuotes -SpreadWidth 5
    Ese vencimiento exacto, con bid/ask por leg y el credito del vertical de $5 en cada strike.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Symbol,
    [int]    $Dte = -1,
    [string] $Expiration,
    [string] $BaseUrl   = 'http://localhost:7001',
    [string] $ApiKey,
    [switch] $Refresh,
    [double] $MinAbsNet = 20,
    [switch] $WithQuotes,
    [double] $SpreadWidth = 0,
    [double] $QuoteBandPct = 0,
    [string] $OutDir    = $env:TEMP
)

$ErrorActionPreference = 'Stop'
$inv = [System.Globalization.CultureInfo]::InvariantCulture

function Step { param([string] $Text) Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Fail { param([string] $Text) Write-Host "`nFALLO: $Text" -ForegroundColor Red; exit 1 }
function Warn { param([string] $Text) Write-Host "AVISO: $Text" -ForegroundColor Yellow }

# ── 1. Credencial ─────────────────────────────────────────────────────────────
# El tablero entra con el JWT de Supabase; un script de maquina no tiene sesion, asi que va por la
# ApiKey. La de user-secrets es la de la API LOCAL: contra produccion hay que pasar -ApiKey.
if (-not $ApiKey) { $ApiKey = $env:GALECORE_API_KEY }
if (-not $ApiKey) {
    # El script vive en research\, asi que la raiz del repo es el directorio de arriba.
    $repoRoot = Split-Path $PSScriptRoot -Parent
    $csproj = Join-Path $repoRoot 'source\galecore-datafeed\DataFeed.Api\DataFeed.Api.csproj'
    if (Test-Path $csproj) {
        $id = ([xml](Get-Content $csproj -Raw)).Project.PropertyGroup.UserSecretsId | Where-Object { $_ }
        $secrets = Join-Path $env:APPDATA "Microsoft\UserSecrets\$id\secrets.json"
        if ($id -and (Test-Path $secrets)) {
            $ApiKey = (Get-Content $secrets -Raw | ConvertFrom-Json).ApiKey
        }
    }
}
if (-not $ApiKey) {
    Fail 'Sin ApiKey. Pasa -ApiKey, defini $env:GALECORE_API_KEY, o corre esto en la maquina que tiene los user-secrets de DataFeed.Api.'
}

# ── 2. Barrido de la cadena ───────────────────────────────────────────────────
$url = "$BaseUrl/App/Gex/Analysis?Symbol=$Symbol&Refresh=$($Refresh.IsPresent.ToString().ToLower())"
Step "GET $url"
if ($Refresh) { Write-Host '    (barrido nuevo: puede tardar varios minutos)' -ForegroundColor DarkGray }

$sw = [Diagnostics.Stopwatch]::StartNew()
try {
    $resp = Invoke-RestMethod -Uri $url -Headers @{ 'X-API-KEY' = $ApiKey } -TimeoutSec 600
} catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int] $_.Exception.Response.StatusCode }
    switch ($status) {
        401     { Fail 'ApiKey rechazada (401). La de user-secrets es la de la API local; produccion usa la suya.' }
        409     { Fail 'La API respondio 409: la estrategia GEX esta APAGADA. Prendela desde Main o desde POST /App/Gex/Switch.' }
        default { Fail "No se pudo consultar la API ($BaseUrl). $($_.Exception.Message)" }
    }
}
$sw.Stop()
Write-Host ("    {0:N0}s" -f $sw.Elapsed.TotalSeconds) -ForegroundColor DarkGray

$expiries = $resp.gex.byExpiry
if (-not $expiries) { Fail "La respuesta no trajo vencimientos para $Symbol." }

# ── 3. Elegir el vencimiento: por fecha exacta o por el DTE mas cercano ───────
if ($Expiration) {
    # Fecha exacta: no hay "el mas cercano". Si no esta, es un error del pedido y no un redondeo
    # silencioso -- pedir el 16-oct y recibir el 2-oct sin enterarse es peor que fallar.
    $target = $expiries | Where-Object { $_.expiration -like "$Expiration*" } | Select-Object -First 1
    if (-not $target) {
        Fail ("La cadena no tiene el vencimiento $Expiration. Disponibles: {0}" -f `
            (($expiries | ForEach-Object { "$($_.expiration) (DTE $($_.dte))" }) -join ', '))
    }
} elseif ($Dte -ge 0) {
    $target = $expiries | Sort-Object { [math]::Abs($_.dte - $Dte) } | Select-Object -First 1
    if ($target.dte -ne $Dte) {
        Warn ("La cadena no tiene un vencimiento a $Dte DTE. El mas cercano es {0} (DTE {1}, {2} dias de diferencia). Disponibles: {3}" -f `
            $target.expiration, $target.dte, [math]::Abs($target.dte - $Dte), (($expiries | ForEach-Object { $_.dte }) -join ', '))
    }
} else {
    Fail 'Falta el vencimiento: pasa -Dte <dias> o -Expiration <yyyy-MM-dd>.'
}

# El tipo lo informa Tastytrade por vencimiento (expiration-type) y el backend lo pasa tal cual en
# byExpiry[].expirationType. Importa porque un weekly y un mensual al MISMO DTE no son el mismo
# contrato: el mensual concentra mucho mas open interest, y de ahi difieren bid/ask y slippage --
# tres de las cosas con las que se decide. El aviso va aca, antes del barrido de quotes, para que
# quien pidio el vencimiento equivocado se entere antes de pagar los minutos.
$expType = if ($target.expirationType) { [string] $target.expirationType } else { '' }
if (-not $expType) {
    Warn 'La cadena no informo el tipo de vencimiento; la columna expirationType del CSV va vacia.'
} elseif ($expType -ne 'Regular') {
    Warn ("El vencimiento {0} es {1}, NO Regular. El bucle de GOT (research\got, seccion 47.1) recorre solo los Regular -- ver research\got\hallazgos\2026-08-24-el-4-sep-es-un-weekly.md." -f `
        $target.expiration, $expType.ToUpper())
}

# ── 4. Bid / ask por leg (opcional) ───────────────────────────────────────────
# /App/Gex/Analysis NO trae precios: el GEX se calcula con gamma y OI, no con el book. El bid/ask
# sale de /Data/Tastytrade/MarketData/Quote, un simbolo por request (~0.2s), asi que la cadena
# entera de un vencimiento son 2 requests por strike. -QuoteBandPct acota a una banda alrededor
# del spot cuando no hace falta toda la cadena.
$quotes = @{}
$spot = [double] $resp.spotPrice
$toQuote = $target.strikes | Sort-Object strike
if ($QuoteBandPct -gt 0) {
    $lo = $spot * (1 - $QuoteBandPct / 100); $hi = $spot * (1 + $QuoteBandPct / 100)
    $toQuote = $toQuote | Where-Object { $_.strike -ge $lo -and $_.strike -le $hi }
}

# La banda esta en PORCENTAJE DE SPOT, pero lo que la estrategia vende esta a una distancia en
# DELTA, y las dos no son la misma cosa: cuanto cubre un +-X% depende de la IV del simbolo y del
# DTE. El +-12% que sobra en un ETF de indice al 13% de IV deja afuera el strike de delta 0.10 de
# un simbolo al 42%, y ahi la captura sale truncada SIN DECIRLO: el CSV se ve normal, pero los
# objetivos de delta del analisis posterior caen todos en el borde de la banda -- el 2026-08-25 los
# tres objetivos de TSLA cayeron en el mismo strike y el cociente se leyo 0.67 en vez de 0.56.
# El aviso va antes del barrido, que es cuando todavia se puede subir la banda sin pagar los
# minutos dos veces. Ver research\got\hallazgos\2026-08-25-el-sesgo-aguanta-con-book-vivo.md.
if ($WithQuotes -and $QuoteBandPct -gt 0 -and $toQuote.Count -gt 0) {
    $bordes = @(
        @{ lado = 'CALL'; delta = ($toQuote | Measure-Object callDelta -Minimum).Minimum },
        @{ lado = 'PUT' ; delta = ($toQuote | ForEach-Object { [math]::Abs($_.putDelta) } | Measure-Object -Minimum).Minimum }
    )
    foreach ($b in $bordes) {
        if ($b.delta -gt 0.10) {
            Warn ("La banda de +-{0}% NO llega al delta 0.10 del lado {1}: el strike mas lejano que entra tiene delta {2:N3}. La captura va a salir truncada justo en la zona que se vende. Subi -QuoteBandPct y volve a capturar." -f `
                $QuoteBandPct, $b.lado, $b.delta)
        }
    }
}

if ($WithQuotes) {
    # OCC de 21 chars: 6 simbolo (padded), yyMMdd, C/P, strike x 1000 en 8 digitos.
    $expDate = [datetime]::Parse($target.expiration.Substring(0, 10), $inv)
    $occRoot = "{0,-6}{1}" -f $Symbol.ToUpper(), $expDate.ToString('yyMMdd')

    Step ("Bid/ask de {0} strikes ({1} legs) desde /Data/Tastytrade/MarketData/Quote" -f $toQuote.Count, ($toQuote.Count * 2))
    $i = 0
    foreach ($s in $toQuote) {
        $i++
        if ($i % 20 -eq 0) { Write-Host ("    {0}/{1}..." -f $i, $toQuote.Count) -ForegroundColor DarkGray }
        $strikeCode = ([long]([math]::Round($s.strike * 1000))).ToString('D8')
        $q = @{}
        foreach ($side in @('C', 'P')) {
            $occ = "$occRoot$side$strikeCode"
            try {
                $r = Invoke-RestMethod -Uri ("$BaseUrl/Data/Tastytrade/MarketData/Quote?Symbol=" + [uri]::EscapeDataString($occ)) `
                     -Headers @{ 'X-API-KEY' = $ApiKey } -TimeoutSec 30
                $ev = $r.data | Select-Object -First 1
                # bid 0 con ask 0 es "no hay book", no un precio de cero: se guarda como ausente.
                if ($ev -and ($ev.bidPrice -gt 0 -or $ev.askPrice -gt 0)) {
                    $q["${side}Bid"] = [double] $ev.bidPrice
                    $q["${side}Ask"] = [double] $ev.askPrice
                }
            } catch { }   # un leg sin quote no invalida la fila: queda vacio
        }
        $quotes[[double] $s.strike] = $q
    }
}

function QVal { param($strike, $key)
    $q = $quotes[[double] $strike]
    if ($q -and $q.ContainsKey($key)) { return [double] $q[$key] }
    return $null
}

# Credito del vertical de riesgo definido, con los dos legs de la MISMA cadena:
#   PCS = vender put en S, comprar put en S-ancho   -> credito = bid(short) - ask(long)
#   CCS = vender call en S, comprar call en S+ancho
# Se usa bid del short y ask del long a proposito: es el peor caso ejecutable, no el mid.
function SpreadCredit { param([double] $strike, [string] $kind)
    if ($SpreadWidth -le 0) { return $null }
    if ($kind -eq 'PCS') { $shortB = QVal $strike 'PBid'; $longA = QVal ($strike - $SpreadWidth) 'PAsk' }
    else                 { $shortB = QVal $strike 'CBid'; $longA = QVal ($strike + $SpreadWidth) 'CAsk' }
    if ($null -eq $shortB -or $null -eq $longA) { return $null }
    return [math]::Round($shortB - $longA, 2)
}

# ── 5. CSV con todos los strikes ──────────────────────────────────────────────
# Punto decimal invariante: con la coma del locale, cualquier consumidor posterior lee texto.
function Num { param($v) if ($null -eq $v) { return '' } return ([double] $v).ToString($inv) }

$csv = Join-Path $OutDir ("{0}_gex_{1}.csv" -f $Symbol.ToUpper(), $target.expiration)
$lines = New-Object System.Collections.Generic.List[string]
$header = 'strike,callGEX_musd,putGEX_musd,netGEX_musd,callOI,putOI,callDelta,putDelta'
if ($WithQuotes)        { $header += ',callBid,callAsk,putBid,putAsk' }
if ($SpreadWidth -gt 0) { $header += ",pcsCredit_w$SpreadWidth,ccsCredit_w$SpreadWidth" }
# Constante en todas las filas, a proposito: es un hecho del archivo, no del strike. Repetirlo es
# lo que hace que viaje CON el dato -- el encabezado de pantalla se pierde y el nombre del archivo
# no lo dice. Va al final para no mover las columnas que ya parsean los scripts de research\got.
$header += ',expirationType'
# IV por strike y por lado -- la superficie, no un promedio. La API la expone desde el 2026-08-25;
# antes la calculaba y la descartaba al mapear. Va al final por la misma razon que expirationType:
# no mover las columnas que ya parsean los scripts. Si la API que responde es anterior al cambio,
# el campo no viene, las celdas salen vacias y el aviso de mas abajo lo dice.
$header += ',callIV,putIV'
$lines.Add($header)
foreach ($s in ($target.strikes | Sort-Object strike)) {
    $row = '{0},{1},{2},{3},{4},{5},{6},{7}' -f `
        $s.strike.ToString($inv), $s.callGEX.ToString($inv), $s.putGEX.ToString($inv),
        $s.netGEX.ToString($inv), $s.callOI, $s.putOI,
        $s.callDelta.ToString($inv), $s.putDelta.ToString($inv)
    if ($WithQuotes) {
        $row += ',{0},{1},{2},{3}' -f (Num (QVal $s.strike 'CBid')), (Num (QVal $s.strike 'CAsk')),
                                      (Num (QVal $s.strike 'PBid')), (Num (QVal $s.strike 'PAsk'))
    }
    if ($SpreadWidth -gt 0) {
        $row += ',{0},{1}' -f (Num (SpreadCredit $s.strike 'PCS')), (Num (SpreadCredit $s.strike 'CCS'))
    }
    $row += ",$expType"
    $row += ',{0},{1}' -f (Num $s.callIV), (Num $s.putIV)
    $lines.Add($row)
}
Set-Content -Path $csv -Value $lines -Encoding utf8

# Una columna entera vacia es el sintoma de que la API que respondio es anterior a que se
# expusiera la IV por strike, y el CSV sale igual de valido en todo lo demas -- o sea, es
# exactamente la clase de degradacion silenciosa que ya costo cara dos veces en este research.
$conIv = @($target.strikes | Where-Object { $_.callIV -gt 0 -or $_.putIV -gt 0 }).Count
if ($conIv -eq 0) {
    Warn 'Ningun strike trajo IV: la API que responde no expone callIV/putIV. Reinicia la API despues de compilar. Las dos columnas del CSV quedan vacias.'
} elseif ($conIv -lt $target.strikes.Count / 2) {
    Warn ("Solo {0} de {1} strikes trajeron IV." -f $conIv, $target.strikes.Count)
}

# ── 5. Lectura en pantalla ────────────────────────────────────────────────────
$sumCall = ($target.strikes | Measure-Object callGEX -Sum).Sum
$sumPut  = ($target.strikes | Measure-Object putGEX  -Sum).Sum
$sumNet  = ($target.strikes | Measure-Object netGEX  -Sum).Sum

Step ("{0} - {1} - DTE {2} - {3}" -f $Symbol.ToUpper(), $target.expiration, $target.dte,
    $(if ($expType) { $expType.ToUpper() } else { 'TIPO DESCONOCIDO' }))
Write-Host ("    Spot {0}   ATM IV {1}   Net GEX {2} B   Call Wall {3}   Put Wall {4}   ZGL {5}" -f `
    $resp.spotPrice, $target.atmIv, $target.netGex, $target.callWall, $target.putWall, $target.gammaZeroLevel)
Write-Host ("    Strikes: {0} en la cadena   |   Suma call {1:N1} M | put {2:N1} M | net {3:N1} M" -f `
    $target.strikes.Count, $sumCall, $sumPut, $sumNet)

$shown = $target.strikes | Where-Object { [math]::Abs($_.netGEX) -ge $MinAbsNet } | Sort-Object strike
Write-Host ("`n    GEX en millones de USD por 1% de movimiento  |  filas con |net| >= {0} M ({1} de {2})" -f `
    $MinAbsNet, $shown.Count, $target.strikes.Count) -ForegroundColor DarkGray
function Cell { param($v) if ($null -eq $v) { return ('{0,7}' -f '-') } return ('{0,7:N2}' -f $v) }

$head = '    {0,8} {1,12} {2,12} {3,12} {4,8} {5,8}' -f 'STRIKE', 'CALL GEX', 'PUT GEX', 'NET GEX', 'CALL OI', 'PUT OI'
if ($WithQuotes)        { $head += '  {0,7} {1,7} {2,7} {3,7}' -f 'C BID', 'C ASK', 'P BID', 'P ASK' }
if ($SpreadWidth -gt 0) { $head += '  {0,7} {1,7}' -f "PCS$SpreadWidth", "CCS$SpreadWidth" }
Write-Host $head
foreach ($s in $shown) {
    # El strike va con '0.##' y no con N0: los de medio dolar existen (352.5) y N0 los redondea,
    # asi que la fila se leia como si fuera la del strike entero de al lado.
    $line = '    {0,8} {1,12:N1} {2,12:N1} {3,12:N1} {4,8:N0} {5,8:N0}' -f `
        $s.strike.ToString('0.##', $inv), $s.callGEX, $s.putGEX, $s.netGEX, $s.callOI, $s.putOI
    if ($WithQuotes) {
        $line += '  {0} {1} {2} {3}' -f (Cell (QVal $s.strike 'CBid')), (Cell (QVal $s.strike 'CAsk')),
                                        (Cell (QVal $s.strike 'PBid')), (Cell (QVal $s.strike 'PAsk'))
    }
    if ($SpreadWidth -gt 0) {
        $line += '  {0} {1}' -f (Cell (SpreadCredit $s.strike 'PCS')), (Cell (SpreadCredit $s.strike 'CCS'))
    }
    Write-Host $line
}
if ($WithQuotes -and $QuoteBandPct -gt 0) {
    Write-Host ("    (bid/ask solo dentro de +-{0}% del spot; fuera de esa banda las celdas van vacias)" -f $QuoteBandPct) -ForegroundColor DarkGray
}
if (-not $shown) { Warn "Ningun strike llega a |net| >= $MinAbsNet M. Baja -MinAbsNet o mira el CSV." }

Step "CSV con los $($target.strikes.Count) strikes: $csv"
