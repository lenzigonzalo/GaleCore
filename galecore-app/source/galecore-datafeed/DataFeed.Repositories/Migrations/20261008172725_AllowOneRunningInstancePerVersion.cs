using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <inheritdoc />
    public partial class AllowOneRunningInstancePerVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_strategy_instances_single_running",
                table: "strategy_instances");

            migrationBuilder.CreateIndex(
                name: "ix_strategy_instances_running_version",
                table: "strategy_instances",
                column: "version_hash",
                unique: true,
                filter: "lifecycle_state = 'RUNNING'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_strategy_instances_running_version",
                table: "strategy_instances");

            migrationBuilder.CreateIndex(
                name: "ix_strategy_instances_single_running",
                table: "strategy_instances",
                column: "lifecycle_state",
                unique: true,
                filter: "lifecycle_state = 'RUNNING'");
        }
    }
}
