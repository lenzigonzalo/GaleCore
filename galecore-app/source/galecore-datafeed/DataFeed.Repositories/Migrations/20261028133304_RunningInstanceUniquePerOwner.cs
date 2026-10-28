using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <inheritdoc />
    public partial class RunningInstanceUniquePerOwner : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_strategy_instances_running_version",
                table: "strategy_instances");

            migrationBuilder.AddColumn<string>(
                name: "deployed_by",
                table: "strategy_instances",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                defaultValue: "SYSTEM");

            // Las instancias existentes toman el dueño de su deployment.
            migrationBuilder.Sql(
                "UPDATE strategy_instances i SET deployed_by = d.deployed_by FROM strategy_deployments d WHERE d.id = i.deployment_id;");

            migrationBuilder.CreateIndex(
                name: "ix_strategy_instances_running_version",
                table: "strategy_instances",
                columns: new[] { "version_hash", "deployed_by" },
                unique: true,
                filter: "lifecycle_state = 'RUNNING'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_strategy_instances_running_version",
                table: "strategy_instances");

            migrationBuilder.DropColumn(
                name: "deployed_by",
                table: "strategy_instances");

            migrationBuilder.CreateIndex(
                name: "ix_strategy_instances_running_version",
                table: "strategy_instances",
                column: "version_hash",
                unique: true,
                filter: "lifecycle_state = 'RUNNING'");
        }
    }
}
