using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <inheritdoc />
    public partial class AddAgentAlerts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "result_json",
                table: "agent_runs",
                type: "character varying(50000)",
                maxLength: 50000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "agent_alerts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    owner_id = table.Column<Guid>(type: "uuid", nullable: false),
                    agent_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    alert_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    run_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_agent_alerts", x => x.id);
                    table.ForeignKey(
                        name: "fk_agent_alerts_users_owner_id",
                        column: x => x.owner_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_agent_alerts_owner_id_agent_key_alert_id",
                table: "agent_alerts",
                columns: new[] { "owner_id", "agent_key", "alert_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_agent_alerts_owner_id_created_at",
                table: "agent_alerts",
                columns: new[] { "owner_id", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agent_alerts");

            migrationBuilder.DropColumn(
                name: "result_json",
                table: "agent_runs");
        }
    }
}
