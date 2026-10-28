using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <inheritdoc />
    public partial class SharedChangesAuthorNoCascade : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_shared_project_changes_users_author_id",
                table: "shared_project_changes");

            migrationBuilder.AddForeignKey(
                name: "fk_shared_project_changes_users_author_id",
                table: "shared_project_changes",
                column: "author_id",
                principalTable: "users",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_shared_project_changes_users_author_id",
                table: "shared_project_changes");

            migrationBuilder.AddForeignKey(
                name: "fk_shared_project_changes_users_author_id",
                table: "shared_project_changes",
                column: "author_id",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
