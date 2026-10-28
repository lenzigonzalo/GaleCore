using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <inheritdoc />
    public partial class ShadowIsAlwaysAuto : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddCheckConstraint(
                name: "ck_strategy_settings_shadow_auto",
                table: "strategy_settings",
                sql: "NOT (stage = 'SHADOW' AND mode = 'MANUAL')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_strategy_settings_shadow_auto",
                table: "strategy_settings");
        }
    }
}
