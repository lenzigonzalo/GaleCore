using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <summary>
    /// Le da a `users` el nombre con el que se entra a la plataforma.
    ///
    /// EN TRES PASOS, y no en uno: la columna nace NULLABLE, se backfillean las filas que ya
    /// existen, y recién ahí se le pone el NOT NULL con su único y su check. El AddColumn que
    /// genera EF por defecto (`nullable: false, defaultValue: ""`) le pondría la cadena vacía a
    /// todas las filas y el check —que exige 3 caracteres— reventaría en la misma transacción; con
    /// dos filas o con dos mil, el resultado es el mismo: la migración no aplica.
    ///
    /// EL BACKFILL DERIVA EL USERNAME DEL MAIL, con la misma regla que `Usernames.FromEmail`:
    /// parte local, a minúscula, lo que no entra en el charset pasa a '-', y se rellena si quedó
    /// corto. Los empates (dos mails distintos que dan el mismo candidato) se numeran, porque el
    /// índice único se crea justo después y un choque dejaría la migración a mitad de camino.
    ///
    /// El email NO se toca: sigue siendo real, único y requerido. Es la identidad de Supabase Auth
    /// —la que recibe el reset de contraseña—; el username es solo la llave con la que el login la
    /// resuelve. Ver docs/GaleCore-plan-reorganizacion-2026-08.md, etapa 3.
    /// </summary>
    public partial class AddUsername : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1) Nullable: las filas que ya están no tienen qué poner todavía.
            migrationBuilder.AddColumn<string>(
                name: "username",
                table: "users",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            // 2) Backfill. El COALESCE cubre el mail sin parte local, el CASE la parte local de uno
            //    o dos caracteres, y el left(..., 32) el mail larguísimo. El row_number() desempata
            //    dos candidatos iguales antes de que exista el índice único.
            //
            //    OJO CON rpad: en Postgres NO solo rellena, también TRUNCA si la cadena ya es más
            //    larga que el largo pedido. Un `rpad(nombre, 3, 'u')` suelto —que es lo natural de
            //    escribir para "rellenar hasta 3"— le corta el username a TRES letras a todo el
            //    mundo: `ericlenzi` sale `eri`. Por eso el relleno va detrás de un CASE que lo
            //    aplica solo cuando hace falta. Se descubrió después de aplicarla (2026-08-13); el
            //    Up corregido es lo que corre en un entorno nuevo.
            migrationBuilder.Sql(@"
                WITH base AS (
                    SELECT id,
                           regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '-', 'g') AS raw
                    FROM users
                ), relleno AS (
                    SELECT id, COALESCE(NULLIF(raw, ''), 'user') AS nombre
                    FROM base
                ), candidato AS (
                    SELECT id,
                           left(CASE WHEN length(nombre) < 3 THEN rpad(nombre, 3, 'u') ELSE nombre END, 32) AS nombre
                    FROM relleno
                ), numerado AS (
                    SELECT id, nombre,
                           row_number() OVER (PARTITION BY nombre ORDER BY id) AS n
                    FROM candidato
                )
                UPDATE users u
                SET username = CASE
                        WHEN numerado.n = 1 THEN numerado.nombre
                        ELSE left(numerado.nombre, 32 - length('-' || numerado.n)) || '-' || numerado.n
                    END
                FROM numerado
                WHERE u.id = numerado.id;
            ");

            // 3) Ahora sí: requerido, único y con el charset.
            migrationBuilder.AlterColumn<string>(
                name: "username",
                table: "users",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32,
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_users_username",
                table: "users",
                column: "username",
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_users_username",
                table: "users",
                sql: "username ~ '^[a-z0-9._-]{3,32}$'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_users_username",
                table: "users");

            migrationBuilder.DropCheckConstraint(
                name: "ck_users_username",
                table: "users");

            migrationBuilder.DropColumn(
                name: "username",
                table: "users");
        }
    }
}
