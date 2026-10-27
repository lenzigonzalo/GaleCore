#Requires -Version 5.1
<#
.SYNOPSIS
    Aplica las migraciones de EF Core sobre la base de GaleCore, mostrando el SQL antes de correrlo.

.DESCRIPTION
    Hermano de deploy-api.ps1, para la otra mitad del despliegue. Igual que aquel, NO cuelga de un
    target de MSBuild ni corre en el arranque de la API: la API nunca migra en runtime, y esa es la
    razon de que existan dos roles de base.

    Lo que este script cuida y a mano se olvida:

    * CON QUE CREDENCIAL va a entrar. El tooling resuelve la cadena en cuatro lugares
      (GaleCoreDbContextFactory) y la de la API tambien "anda" -- hasta que `database update` falla
      con `permission denied`, cuando ya perdiste el viaje. Aca se resuelve y se nombra ANTES.
    * EL PUERTO. Va el 5432 (sesion). En el 6543 (pooler de transaccion) las cosas de sesion no se
      comportan, y el sintoma no dice eso.
    * EL SQL SE VE ANTES. Una migracion no tiene rollback: no hay backup de la base en este flujo.
      El script genera el script idempotente entre lo aplicado y el destino, y lo muestra entero.
    * DISTINGUE ADITIVO DE DESTRUCTIVO, porque el orden contra el deploy cambia:
        - aditivo (CREATE TABLE / ADD COLUMN)    -> migrar ANTES de deploy-api.ps1
        - destructivo (DROP COLUMN / DROP TABLE) -> deployar PRIMERO el binario que ya no la usa, y
          recien en un deploy posterior correr la migracion. Expand / contract.
      El script no decide por vos: te lo dice y te hace confirmar.
    * SI NACE UNA TABLA, recuerda el ALTER DEFAULT PRIVILEGES. Sin eso la tabla nueva nace sin
      permisos para galecore_api y el fallo aparece en runtime, lejos del cambio que lo causo.

    Lo que NO hace: verificar los grants contra la base. Eso necesita psql, que no esta instalado en
    la maquina del operador; cuando la migracion crea una tabla, el script imprime la consulta para
    correr en el editor SQL de Supabase. Automatizarlo es una decision aparte.

.PARAMETER Target
    Migracion destino. Por defecto la ultima. `0` revierte todo (el SQL generado lo va a mostrar).

.PARAMETER DryRun
    Genera y muestra el SQL, y termina. No toca la base.

.PARAMETER Yes
    No pregunta antes de aplicar. Para cuando ya miraste el SQL con -DryRun.

.EXAMPLE
    .\migrate-db.ps1 -DryRun
    Que hay pendiente y que SQL correria, sin tocar nada.

.EXAMPLE
    .\migrate-db.ps1
    Muestra el SQL, pide confirmacion y aplica.

.NOTES
    La credencial de DDL se carga una sola vez por maquina:
      dotnet user-secrets set "ConnectionStrings:GaleCoreDdl" "<cadena>" --project DataFeed.Repositories
    La contrasena de galecore_ddl vive en el gestor de contrasenas del operador (2026-09-01).
    Racional completo: docs/GaleCore-arquitectura-datos.md seccion 10.
#>
[CmdletBinding()]
param(
    [string] $Target,
    [switch] $DryRun,
    [switch] $Yes
)

$ErrorActionPreference = 'Stop'

$project = Join-Path $PSScriptRoot 'source\galecore-datafeed\DataFeed.Repositories'
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$sqlFile = Join-Path $env:TEMP "galecore-migration-$stamp.sql"

function Step { param([string] $Text) Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Fail { param([string] $Text) Write-Host "`nFALLO: $Text" -ForegroundColor Red; exit 1 }
function Note { param([string] $Text) Write-Host "    $Text" }

function Get-CsPart {
    param([string] $Cs, [string] $Key)
    foreach ($kv in ($Cs -split ';')) {
        $pair = $kv -split '=', 2
        if ($pair.Count -eq 2 -and $pair[0].Trim() -ieq $Key) { return $pair[1].Trim() }
    }
    return $null
}

# Corre `dotnet ef` y devuelve su salida. No redirige stderr: en PS 5.1 eso convierte cada linea de
# un exe nativo en un ErrorRecord y ensucia $? aunque el comando haya salido con 0.
function Invoke-Ef {
    param([string[]] $EfArgs)
    return (& dotnet @(@('ef') + $EfArgs))
}

# -- 0. Herramienta -----------------------------------------------------------
Step 'Verificando el tooling de EF'
$efVersion = (& dotnet ef --version) | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) {
    Fail "No esta dotnet-ef. Instalalo con:`n  dotnet tool install --global dotnet-ef --version 8.*"
}
Note "dotnet-ef $efVersion"
if (-not (Test-Path $project)) { Fail "No encuentro el proyecto en $project" }

# -- 1. Con que credencial vamos a entrar -------------------------------------
# Replica el orden de GaleCoreDbContextFactory.ResolveConnectionString(). Si cambia alla, cambia aca.
Step 'Resolviendo la cadena de conexion (mismo orden que GaleCoreDbContextFactory)'

$cs = $null; $csSource = $null

$fromEnv = $env:GALECORE_DB
if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
    $cs = $fromEnv
    $csSource = 'variable de entorno GALECORE_DB'
} else {
    # `user-secrets list` imprime los valores: se captura, se parsea, y NUNCA se imprime entero.
    $secrets = & dotnet user-secrets list --project $project
    $ddlLine = $secrets | Where-Object { $_ -match '^ConnectionStrings:GaleCoreDdl\s*=' } | Select-Object -First 1
    if ($ddlLine) {
        $cs = ($ddlLine -split '=', 2)[1].Trim()
        $csSource = 'user-secrets de DataFeed.Repositories (ConnectionStrings:GaleCoreDdl)'
    }
}

if (-not $cs) {
    Fail @"
No hay credencial de DDL en esta maquina, asi que el tooling caeria a la cadena de la API
(galecore_api) y 'database update' fallaria con 'permission denied': ese rol no puede hacer DDL.

Cargala una sola vez (la contrasena de galecore_ddl esta en el gestor de contrasenas del operador):
  dotnet user-secrets set "ConnectionStrings:GaleCoreDdl" "<cadena>" --project DataFeed.Repositories

Ver docs/GaleCore-arquitectura-datos.md seccion 10.
"@
}

$csHost = Get-CsPart $cs 'Host'
$csPort = Get-CsPart $cs 'Port'
$csUser = Get-CsPart $cs 'Username'
$csDb   = Get-CsPart $cs 'Database'

Note "origen:  $csSource"
Note "host:    ${csHost}:${csPort}"
Note "base:    $csDb"
Note "usuario: $csUser"

if ($csPort -eq '6543') {
    Fail 'El puerto es el 6543 (pooler de transaccion). Las migraciones van por el 5432 (sesion).'
}
if ($csUser -and $csUser -notmatch '^galecore_ddl') {
    Write-Host '    AVISO: el usuario no es galecore_ddl. Si no es dueno de las tablas, esto va a fallar.' -ForegroundColor Yellow
}
if ($csHost -match 'pooler' -and $csUser -notmatch '\.') {
    Write-Host '    AVISO: host de pooler y usuario sin sufijo de proyecto (galecore_ddl.<project-ref>).' -ForegroundColor Yellow
}

# -- 2. El modelo vs las migraciones ------------------------------------------
Step 'Verificando que el modelo no tenga cambios sin migracion'
Invoke-Ef @('migrations', 'has-pending-model-changes', '--project', $project, '--startup-project', $project) | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host '    AVISO: hay cambios en el modelo posteriores a la ultima migracion.' -ForegroundColor Yellow
    Write-Host '    Lo que apliques ahora NO va a dejar la base igual al modelo del codigo.' -ForegroundColor Yellow
} else {
    Note 'El modelo coincide con la ultima migracion.'
}

# -- 3. Que hay aplicado y que hay pendiente ----------------------------------
Step 'Consultando el estado de las migraciones en la base'
$listOut = Invoke-Ef @('migrations', 'list', '--project', $project, '--startup-project', $project)
if ($listOut | Where-Object { $_ -match 'Pending status not shown' }) {
    Fail 'No se pudo leer __EFMigrationsHistory. Revisa la credencial y el acceso a la base.'
}

$migrations = @()
foreach ($line in $listOut) {
    if ($line -match '^\s*(\d{14}_\S+?)(\s+\(Pending\))?\s*$') {
        $migrations += [PSCustomObject]@{ Id = $Matches[1]; Pending = [bool]$Matches[2] }
    }
}
if (-not $migrations) { Fail 'No se listo ninguna migracion. Revisa el proyecto y el build.' }

$applied = @($migrations | Where-Object { -not $_.Pending })
$pending = @($migrations | Where-Object { $_.Pending })

foreach ($m in $migrations) {
    if ($m.Pending) { Write-Host ('    PENDIENTE  ' + $m.Id) -ForegroundColor Yellow }
    else            { Write-Host ('    aplicada   ' + $m.Id) }
}

if (-not $pending -and -not $Target) {
    Write-Host "`nNo hay migraciones pendientes. La base ya esta al dia." -ForegroundColor Green
    exit 0
}

$from = if ($applied) { $applied[-1].Id } else { '0' }
$to   = if ($Target)  { $Target }         else { $migrations[-1].Id }

# -- 4. El SQL, antes de correrlo ---------------------------------------------
Step "Generando el SQL idempotente de $from a $to"
Invoke-Ef @('migrations', 'script', $from, $to, '--idempotent',
            '--project', $project, '--startup-project', $project, '--output', $sqlFile) | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'dotnet ef migrations script devolvio error.' }
Note $sqlFile

Write-Host "`n--- SQL ---------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host (Get-Content $sqlFile -Raw)
Write-Host "--- fin del SQL -------------------------------------------------------`n" -ForegroundColor DarkGray

# -- 5. Aditivo o destructivo: el orden contra el deploy cambia ----------------
$sqlLines = Get-Content $sqlFile
$destructivas = @($sqlLines | Where-Object {
    $_ -match '(?i)\bDROP\s+(TABLE|SCHEMA|COLUMN)\b' -or $_ -match '(?i)\bTRUNCATE\b'
})
$creaTablas = @($sqlLines | Where-Object {
    $_ -match '(?i)^\s*CREATE\s+TABLE' -and $_ -notmatch '__EFMigrationsHistory'
})

Step 'Clasificando el cambio'
if ($destructivas) {
    Write-Host '    DESTRUCTIVO. Estas lineas borran esquema o datos:' -ForegroundColor Red
    $destructivas | ForEach-Object { Write-Host ('      ' + $_.Trim()) -ForegroundColor Red }
    Write-Host ''
    Write-Host '    Orden correcto (expand / contract): PRIMERO deployar el binario que ya no usa' -ForegroundColor Yellow
    Write-Host '    lo que se borra, verificar que la API responde, y RECIEN AHI correr esto.' -ForegroundColor Yellow
    Write-Host '    Al reves, la API vieja queda pegandole a algo que ya no existe.' -ForegroundColor Yellow
} else {
    Note 'Aditivo: no borra esquema ni datos. Va ANTES de deploy-api.ps1.'
}
if ($creaTablas) {
    Note ('Crea ' + $creaTablas.Count + ' tabla(s): al final se recuerda la verificacion de permisos.')
}

if ($DryRun) {
    Write-Host "`n-DryRun: no se aplico nada. El SQL quedo en $sqlFile" -ForegroundColor Green
    exit 0
}

# -- 6. Confirmacion ----------------------------------------------------------
if (-not $Yes) {
    Write-Host ''
    Write-Host 'Esto se aplica sobre la base productiva y NO tiene rollback.' -ForegroundColor Yellow
    Write-Host 'Escribi  aplicar  para seguir; cualquier otra cosa cancela.' -ForegroundColor Yellow
    $answer = Read-Host '   >'
    if ($answer -ne 'aplicar') {
        Write-Host "`nCancelado. No se aplico nada. El SQL quedo en $sqlFile"
        exit 0
    }
}

# -- 7. Aplicar ---------------------------------------------------------------
Step "Aplicando hasta $to"
$updateArgs = @('database', 'update')
if ($Target) { $updateArgs += $Target }
$updateArgs += @('--project', $project, '--startup-project', $project)
Invoke-Ef $updateArgs
if ($LASTEXITCODE -ne 0) { Fail 'dotnet ef database update devolvio error. La base pudo quedar a medio migrar.' }

# -- 8. Verificar -------------------------------------------------------------
Step 'Verificando que no quede nada pendiente'
$after  = Invoke-Ef @('migrations', 'list', '--project', $project, '--startup-project', $project)
$quedan = @($after | Where-Object { $_ -match '\(Pending\)' })
if ($quedan -and -not $Target) {
    Write-Host '    Todavia figuran como pendientes:' -ForegroundColor Yellow
    $quedan | ForEach-Object { Write-Host ('      ' + $_.Trim()) -ForegroundColor Yellow }
} else {
    Note 'Sin pendientes.'
}

if ($creaTablas) {
    Write-Host "`nTABLA NUEVA: verifica los permisos ANTES de deployar." -ForegroundColor Yellow
    Write-Host 'Sin grants, galecore_api falla en runtime lejos de este cambio. En el editor SQL de Supabase:' -ForegroundColor Yellow
    Write-Host @'

  -- 1. Que ve galecore_api en cada tabla (esperado: SELECT, INSERT, UPDATE, DELETE)
  select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'galecore_api'
  group by table_name order by table_name;

  -- 2. Que la proxima tabla nazca con permisos (esperado: al menos una fila)
  select d.defaclobjtype, d.defaclacl
  from pg_default_acl d join pg_roles r on r.oid = d.defaclrole
  where r.rolname = 'galecore_ddl';

'@
}

Write-Host "Migracion OK. El SQL aplicado quedo en $sqlFile" -ForegroundColor Green
if (-not $destructivas) {
    Write-Host 'Siguiente paso: .\deploy-api.ps1' -ForegroundColor Green
}
