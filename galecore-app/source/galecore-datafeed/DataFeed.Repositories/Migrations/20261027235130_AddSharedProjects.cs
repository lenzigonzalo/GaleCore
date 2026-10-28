using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <inheritdoc />
    public partial class AddSharedProjects : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "shared_projects",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    owner_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    local_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_shared_projects", x => x.id);
                    table.CheckConstraint("ck_shared_projects_kind", "kind IN ('workspace','strategy')");
                    table.ForeignKey(
                        name: "fk_shared_projects_users_owner_id",
                        column: x => x.owner_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "shared_project_changes",
                columns: table => new
                {
                    seq = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    author_id = table.Column<Guid>(type: "uuid", nullable: false),
                    path = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    op = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    encoding = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    content = table.Column<string>(type: "text", nullable: true),
                    content_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    base_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_shared_project_changes", x => x.seq);
                    table.CheckConstraint("ck_shared_project_changes_encoding", "encoding IN ('utf8','base64')");
                    table.CheckConstraint("ck_shared_project_changes_op", "op IN ('put','delete')");
                    table.CheckConstraint("ck_shared_project_changes_path", "path !~ '^/' AND position(chr(92) in path) = 0 AND path !~ '(^|/)[.][.](/|$)' AND length(path) <= 400");
                    table.ForeignKey(
                        name: "fk_shared_project_changes_shared_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "shared_projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_shared_project_changes_users_author_id",
                        column: x => x.author_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "shared_project_members",
                columns: table => new
                {
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    added_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_shared_project_members", x => new { x.project_id, x.user_id });
                    table.CheckConstraint("ck_shared_project_members_role", "role IN ('owner','member')");
                    table.ForeignKey(
                        name: "fk_shared_project_members_shared_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "shared_projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_shared_project_members_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_shared_project_changes_author_id",
                table: "shared_project_changes",
                column: "author_id");

            migrationBuilder.CreateIndex(
                name: "ix_shared_project_changes_project_id_path_seq",
                table: "shared_project_changes",
                columns: new[] { "project_id", "path", "seq" });

            migrationBuilder.CreateIndex(
                name: "ix_shared_project_changes_project_id_seq",
                table: "shared_project_changes",
                columns: new[] { "project_id", "seq" });

            migrationBuilder.CreateIndex(
                name: "ix_shared_project_members_user_id",
                table: "shared_project_members",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_shared_projects_owner_id",
                table: "shared_projects",
                column: "owner_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "shared_project_changes");

            migrationBuilder.DropTable(
                name: "shared_project_members");

            migrationBuilder.DropTable(
                name: "shared_projects");
        }
    }
}
