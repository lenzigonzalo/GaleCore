using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <inheritdoc />
    public partial class AddShadowRuntime : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "strategy_specs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    version = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    content_hash = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    spec_json = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_strategy_specs", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "strategy_deployments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    spec_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version_hash = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    mode = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    deployed_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    deployed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_strategy_deployments", x => x.id);
                    table.ForeignKey(
                        name: "fk_strategy_deployments_strategy_specs_spec_id",
                        column: x => x.spec_id,
                        principalTable: "strategy_specs",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "strategy_instances",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    deployment_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version_hash = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    lifecycle_state = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    scheduler_state = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    spec_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    mode = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_strategy_instances", x => x.id);
                    table.ForeignKey(
                        name: "fk_strategy_instances_strategy_deployments_deployment_id",
                        column: x => x.deployment_id,
                        principalTable: "strategy_deployments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "evaluation_logs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    instance_id = table.Column<Guid>(type: "uuid", nullable: false),
                    symbol = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    overall_pass = table.Column<bool>(type: "boolean", nullable: false),
                    results_json = table.Column<string>(type: "text", nullable: false),
                    evaluated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    seq = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_evaluation_logs", x => x.id);
                    table.ForeignKey(
                        name: "fk_evaluation_logs_strategy_instances_instance_id",
                        column: x => x.instance_id,
                        principalTable: "strategy_instances",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "operational_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    instance_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    symbol = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    payload_json = table.Column<string>(type: "text", nullable: false),
                    timestamp = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    seq = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_operational_events", x => x.id);
                    table.ForeignKey(
                        name: "fk_operational_events_strategy_instances_instance_id",
                        column: x => x.instance_id,
                        principalTable: "strategy_instances",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "shadow_positions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    instance_id = table.Column<Guid>(type: "uuid", nullable: false),
                    candidate_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    symbol = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    structure = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    legs_json = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    entry_credit = table.Column<double>(type: "double precision", nullable: false),
                    max_risk = table.Column<double>(type: "double precision", nullable: false),
                    width = table.Column<double>(type: "double precision", nullable: false),
                    entry_dte = table.Column<int>(type: "integer", nullable: false),
                    entry_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    exit_debit = table.Column<double>(type: "double precision", nullable: true),
                    exit_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    exit_reason = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    realized_pnl = table.Column<double>(type: "double precision", nullable: true),
                    unrealized_pnl = table.Column<double>(type: "double precision", nullable: true),
                    last_spread_value = table.Column<double>(type: "double precision", nullable: true),
                    current_dte = table.Column<int>(type: "integer", nullable: true),
                    last_valued_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    valuation_problems_json = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_shadow_positions", x => x.id);
                    table.ForeignKey(
                        name: "fk_shadow_positions_strategy_instances_instance_id",
                        column: x => x.instance_id,
                        principalTable: "strategy_instances",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_evaluation_logs_instance_id_evaluated_at_seq",
                table: "evaluation_logs",
                columns: new[] { "instance_id", "evaluated_at", "seq" });

            migrationBuilder.CreateIndex(
                name: "ix_operational_events_instance_id_timestamp_seq",
                table: "operational_events",
                columns: new[] { "instance_id", "timestamp", "seq" });

            migrationBuilder.CreateIndex(
                name: "ix_shadow_positions_instance_id_status",
                table: "shadow_positions",
                columns: new[] { "instance_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_strategy_deployments_spec_id",
                table: "strategy_deployments",
                column: "spec_id");

            migrationBuilder.CreateIndex(
                name: "ix_strategy_instances_deployment_id",
                table: "strategy_instances",
                column: "deployment_id");

            migrationBuilder.CreateIndex(
                name: "ix_strategy_instances_single_running",
                table: "strategy_instances",
                column: "lifecycle_state",
                unique: true,
                filter: "lifecycle_state = 'RUNNING'");

            migrationBuilder.CreateIndex(
                name: "ix_strategy_specs_content_hash",
                table: "strategy_specs",
                column: "content_hash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "evaluation_logs");

            migrationBuilder.DropTable(
                name: "operational_events");

            migrationBuilder.DropTable(
                name: "shadow_positions");

            migrationBuilder.DropTable(
                name: "strategy_instances");

            migrationBuilder.DropTable(
                name: "strategy_deployments");

            migrationBuilder.DropTable(
                name: "strategy_specs");
        }
    }
}
