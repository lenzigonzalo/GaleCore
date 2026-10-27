using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "strategies",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    prefix = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    label = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    description = table.Column<string>(type: "text", nullable: false),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    rules_endpoint = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    switch_endpoint = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_strategies", x => x.id);
                    table.CheckConstraint("ck_strategies_kind", "kind IN ('operativa', 'informativa')");
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    is_admin = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_users", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "accounts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    broker = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    account_number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    refresh_token_encrypted = table.Column<string>(type: "text", nullable: false),
                    is_system = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_accounts", x => x.id);
                    table.ForeignKey(
                        name: "fk_accounts_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
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
                name: "ix_accounts_single_system",
                table: "accounts",
                column: "is_system",
                unique: true,
                filter: "is_system");

            migrationBuilder.CreateIndex(
                name: "ix_accounts_user_id_broker_account_number",
                table: "accounts",
                columns: new[] { "user_id", "broker", "account_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_strategies_prefix",
                table: "strategies",
                column: "prefix",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_user_strategies_strategy_id",
                table: "user_strategies",
                column: "strategy_id");

            migrationBuilder.CreateIndex(
                name: "ix_users_email",
                table: "users",
                column: "email",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "accounts");

            migrationBuilder.DropTable(
                name: "user_strategies");

            migrationBuilder.DropTable(
                name: "strategies");

            migrationBuilder.DropTable(
                name: "users");
        }
    }
}
