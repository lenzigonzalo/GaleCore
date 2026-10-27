using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Repositories
{
    /// <summary>
    /// Fábrica que usa SOLO el tooling de EF (dotnet ef migrations / database update). No participa
    /// en el runtime de la API: ahí el DbContext lo arma la inyección de dependencias.
    ///
    /// Existe para que el tooling no dependa del proyecto Api. Si no existiera, `migrations add`
    /// tendría que resolver el DbContext desde la DI de la API — y como ahí el registro es
    /// condicional a que haya cadena configurada, un desarrollador sin el secreto no podría ni
    /// generar una migración.
    ///
    /// Busca la cadena en cuatro lugares, en orden:
    ///   1. GALECORE_DB (variable de entorno) — para CI y para apuntar a otra base a propósito.
    ///   2. `ConnectionStrings:GaleCoreDdl` en el secret store DE ESTE PROYECTO — el rol dueño de
    ///      las tablas. Es la única de las cuatro con la que `database update` puede aplicar algo.
    ///   3. `ConnectionStrings:GaleCore` en el secret store de DataFeed.Api — el rol de la API.
    ///      Alcanza para `migrations add` y `migrations script`, que solo necesitan el modelo.
    ///   4. Un placeholder, para cuando no hay ni eso.
    ///
    /// POR QUÉ DOS ROLES Y NO UNO. `galecore_api` no puede hacer DDL: las tablas son de
    /// `galecore_ddl`, y ese es el punto — la credencial que vive en el VPS y corre en el camino
    /// caliente no tiene con qué alterar el esquema. El costo es que aplicar una migración necesita
    /// OTRA credencial, y hasta 2026-09-01 esa credencial no estaba guardada en ningún lado: cada
    /// migración empezaba por resetear una contraseña. El paso 2 es lo que cierra eso.
    ///
    /// El paso 3 no aplica migraciones, y su error lo dice claro (`permission denied`) en vez de
    /// fallar de un modo ambiguo. Se conserva porque `migrations add` es lo más frecuente y no
    /// tiene por qué exigir la credencial más poderosa.
    ///
    /// **Nada de esto lo lee la API en runtime**: ahí el DbContext lo arma la inyección de
    /// dependencias con `ConnectionStrings:GaleCore` y esta clase no participa.
    ///
    /// Para cargar la credencial de DDL (una sola vez, y la contraseña no queda en el historial de
    /// la shell si se usa el prompt del gestor de contraseñas):
    ///   dotnet user-secrets set "ConnectionStrings:GaleCoreDdl" "&lt;cadena&gt;" --project DataFeed.Repositories
    /// </summary>
    public class GaleCoreDbContextFactory : IDesignTimeDbContextFactory<GaleCoreDbContext>
    {
        /// <summary>
        /// UserSecretsId de DataFeed.Api. No es un secreto — es el mismo identificador que está en
        /// el .csproj, y solo dice en qué carpeta de %APPDATA% buscar. Si se regenera allá, hay que
        /// actualizarlo acá.
        /// </summary>
        private const string ApiUserSecretsId = "129a9ead-8af9-443d-87fd-2c4529063094";

        /// <summary>
        /// UserSecretsId de ESTE proyecto — el del .csproj de acá al lado. Tampoco es un secreto:
        /// solo dice en qué carpeta de %APPDATA% buscar. Va como constante y no por el atributo que
        /// genera el SDK para que se lea igual que el de arriba.
        /// </summary>
        private const string RepositoriesUserSecretsId = "56463cb7-beb4-4e11-b331-dbe1a0135975";

        private const string PlaceholderForModelOnly =
            "Host=localhost;Port=5432;Database=postgres;Username=postgres;Password=placeholder";

        public GaleCoreDbContext CreateDbContext(string[] args)
        {
            var options = new DbContextOptionsBuilder<GaleCoreDbContext>()
                .UseNpgsql(ResolveConnectionString())
                .UseSnakeCaseNamingConvention()
                .Options;

            return new GaleCoreDbContext(options);
        }

        private static string ResolveConnectionString()
        {
            var fromEnv = Environment.GetEnvironmentVariable("GALECORE_DB");
            if (!string.IsNullOrWhiteSpace(fromEnv)) return fromEnv;

            var ddl = new ConfigurationBuilder()
                .AddUserSecrets(RepositoriesUserSecretsId)
                .Build()
                .GetConnectionString("GaleCoreDdl");
            if (!string.IsNullOrWhiteSpace(ddl)) return ddl;

            var api = new ConfigurationBuilder()
                .AddUserSecrets(ApiUserSecretsId)
                .Build()
                .GetConnectionString("GaleCore");
            if (!string.IsNullOrWhiteSpace(api)) return api;

            return PlaceholderForModelOnly;
        }
    }
}
