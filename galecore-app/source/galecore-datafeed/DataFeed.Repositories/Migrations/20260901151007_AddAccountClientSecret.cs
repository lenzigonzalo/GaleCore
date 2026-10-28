using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataFeed.Repositories.Migrations
{
    /// <summary>
    /// Le da a cada cuenta la mitad que le faltaba a su credencial: el client_secret de SU
    /// aplicación OAuth.
    ///
    /// Hasta hoy había un solo client_secret para toda la plataforma, en configuración, y el
    /// refresh token era lo único por usuario. Eso funciona mientras todos entren por la misma
    /// aplicación OAuth registrada; en cuanto un operador registra la suya en su perfil de
    /// Tastytrade, las dos mitades dejan de coincidir y el canje contesta
    /// `invalid_grant / Client secret mismatch` — que fue exactamente lo que paso el 2026-09-01.
    ///
    /// NULLABLE Y SIN BACKFILL, a diferencia de AddUsername: acá null no es un dato que falta sino
    /// un valor con significado, "usá el client_secret de configuración". Las filas que ya existen
    /// —incluida la `is_system`, que es de la aplicación de la plataforma— siguen andando sin que
    /// nadie las toque, y por eso esta migración no necesita ni backfill ni un segundo paso que
    /// ponga el NOT NULL.
    ///
    /// El valor entra CIFRADO con la misma clave que el refresh token (Security:TokenProtectionKey).
    /// La columna es `text` y no tiene ningún constraint que lo verifique: quien escriba acá tiene
    /// que cifrar, y eso lo garantiza el endpoint, no la base.
    /// </summary>
    public partial class AddAccountClientSecret : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "client_secret_encrypted",
                table: "accounts",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "client_secret_encrypted",
                table: "accounts");
        }
    }
}
