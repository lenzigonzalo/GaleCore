using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <inheritdoc />
    public partial class AddPreferenceSpaceKind : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_trader_space_kind",
                table: "trader_space_items");

            migrationBuilder.AddCheckConstraint(
                name: "ck_trader_space_kind",
                table: "trader_space_items",
                sql: "kind IN ('profile','objective','convention','memory','skill','agent','data','preference')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_trader_space_kind",
                table: "trader_space_items");

            migrationBuilder.AddCheckConstraint(
                name: "ck_trader_space_kind",
                table: "trader_space_items",
                sql: "kind IN ('profile','objective','convention','memory','skill','agent','data')");
        }
    }
}
