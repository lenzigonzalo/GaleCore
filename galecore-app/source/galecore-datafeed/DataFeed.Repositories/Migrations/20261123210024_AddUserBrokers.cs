using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <inheritdoc />
    public partial class AddUserBrokers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "user_brokers",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    broker = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    include_in_portfolio = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    secret_cipher = table.Column<string>(type: "text", nullable: true),
                    secret_hint = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_check_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    last_check_ok = table.Column<bool>(type: "boolean", nullable: true),
                    last_check_message = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_brokers", x => new { x.user_id, x.broker });
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user_brokers");
        }
    }
}
