using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <summary>
    /// Carga inicial del catálogo con las dos estrategias implementadas, tomadas de strategies[] de
    /// galecore_rules_core.json — que es de donde se mudan.
    ///
    /// SQL crudo con ON CONFLICT DO NOTHING, y NO HasData, a propósito. Con HasData estas filas
    /// quedan gobernadas por EF: es un seed declarativo que el tooling compara contra el modelo y
    /// vuelve a imponer en cada migración. Pero justamente el motivo de mudar el catálogo a la base
    /// es poder EDITAR el nombre o la descripción sin tocar código — y esos dos mecanismos se
    /// pelean: EF generaría updates para "corregir" lo que el operador cambió a mano.
    ///
    /// Así, en cambio, es una carga de una sola vez: si la fila ya existe, no se toca nada. La base
    /// pasa a ser dueña de estos datos apenas se insertan.
    ///
    /// No se siembra ninguna versión: la versión sale del _meta.version de cada JSON de reglas, que
    /// es su fuente de verdad. La tabla no la duplica.
    ///
    /// El id va en minúscula y el prefix capitalizado (convención de CLAUDE.md): el prefix está
    /// compilado en [Route("App/Rpf")], en Files/Rpf/ y en el tag de Swagger.
    /// </summary>
    public partial class SeedStrategies : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                INSERT INTO strategies
                    (id, prefix, label, name, description, kind, rules_endpoint, switch_endpoint)
                VALUES
                    ('gex', 'Gex', 'GEX', 'Gamma Exposure',
                     'GEX global de toda la cadena dentro de max_dte, incluido 0DTE. No propone estructura ni emite señales: su unico producto es informacion.',
                     'informativa', '/App/Gex/Rules', '/App/Gex/Switch'),
                    ('rpf', 'Rpf', 'RPF', 'Disparo por prima real',
                     'Maquina de 7 estados sobre el loop backend. Sugiere operaciones por SignalR; nunca ejecuta.',
                     'operativa', '/App/Rpf/Rules', '/App/Rpf/Switch')
                ON CONFLICT (id) DO NOTHING;
            ");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Solo las filas que sembró esta migración. Un DELETE sin WHERE se llevaría puestas las
            // estrategias que se hayan agregado después.
            migrationBuilder.Sql("DELETE FROM strategies WHERE id IN ('gex', 'rpf');");
        }
    }
}
