using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <summary>
    /// Saca de la base el catálogo de estrategias y la preferencia por usuario de su switch.
    ///
    /// POR QUÉ: el catálogo que la aplicación consume siempre fue `strategies[]` de
    /// galecore_rules_core.json — nadie leyó nunca la tabla (no había una sola consulta contra
    /// `db.Strategies`), y su prefijo está compilado en [Route("App/Rpf")], en Files/Rpf/, en el tag
    /// de Swagger y en el id de pestaña del front, así que una tabla no puede ser dueña de eso.
    /// Con el catálogo afuera, `user_strategies` se queda sin el lado "uno" de su FK, y el switch
    /// vuelve a ser global. Ver docs/GaleCore-plan-reorganizacion-2026-08.md, etapa 1.
    ///
    /// OJO CON EL Down: recrea las tablas VACÍAS. El seed vive en la migración SeedStrategies, que
    /// ya corrió y no vuelve a correr — si alguna vez hay que volver atrás de verdad, hay que
    /// reinsertar las filas a mano.
    /// </summary>
    public partial class DropStrategyTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user_strategies");

            migrationBuilder.DropTable(
                name: "strategies");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "strategies",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    description = table.Column<string>(type: "text", nullable: false),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    label = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    prefix = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    rules_endpoint = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    switch_endpoint = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_strategies", x => x.id);
                    table.CheckConstraint("ck_strategies_kind", "kind IN ('operativa', 'informativa')");
                });

            migrationBuilder.CreateTable(
                name: "user_strategies",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    strategy_id = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_strategies", x => new { x.user_id, x.strategy_id });
                    table.ForeignKey(
                        name: "fk_user_strategies_strategies_strategy_id",
                        column: x => x.strategy_id,
                        principalTable: "strategies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_user_strategies_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_strategies_prefix",
                table: "strategies",
                column: "prefix",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_user_strategies_strategy_id",
                table: "user_strategies",
                column: "strategy_id");
        }
    }
}
