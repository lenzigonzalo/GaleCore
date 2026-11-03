using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <inheritdoc />
    public partial class AddSharedProjectAccess : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "access",
                table: "shared_projects",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "restricted");

            migrationBuilder.AddCheckConstraint(
                name: "ck_shared_projects_access",
                table: "shared_projects",
                sql: "access IN ('restricted','everyone')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_shared_projects_access",
                table: "shared_projects");

            migrationBuilder.DropColumn(
                name: "access",
                table: "shared_projects");
        }
    }
}
