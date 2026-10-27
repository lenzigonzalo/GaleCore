using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <inheritdoc />
    public partial class AddTraderSpace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "trader_space_items",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    owner_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    content = table.Column<string>(type: "text", nullable: false),
                    format = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false, defaultValue: "markdown"),
                    visibility = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false, defaultValue: "private"),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_trader_space_items", x => x.id);
                    table.CheckConstraint("ck_trader_space_format", "format IN ('markdown','json')");
                    table.CheckConstraint("ck_trader_space_key", "key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'");
                    table.CheckConstraint("ck_trader_space_kind", "kind IN ('profile','objective','convention','memory','skill','agent','data')");
                    table.CheckConstraint("ck_trader_space_visibility", "visibility IN ('private','shared')");
                    table.ForeignKey(
                        name: "fk_trader_space_items_users_owner_id",
                        column: x => x.owner_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_trader_space_items_owner_id_kind_key",
                table: "trader_space_items",
                columns: new[] { "owner_id", "kind", "key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_trader_space_items_visibility",
                table: "trader_space_items",
                column: "visibility");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "trader_space_items");
        }
    }
}
