using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <inheritdoc />
    public partial class AddShadowPositionContext : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "entry_context_json",
                table: "shadow_positions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "exit_context_json",
                table: "shadow_positions",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "entry_context_json",
                table: "shadow_positions");

            migrationBuilder.DropColumn(
                name: "exit_context_json",
                table: "shadow_positions");
        }
    }
}
