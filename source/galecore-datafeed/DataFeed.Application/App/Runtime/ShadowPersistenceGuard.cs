using System.Net;
using Npgsql;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// SHADOW persiste sólo en una base local (GC-0004, AC-03; decisión del owner, 24/09: la
    /// persistencia de SHADOW nunca se conecta a producción). La API usa una sola cadena
    /// (`ConnectionStrings:GaleCore`) para usuarios y runtime; si esa cadena apunta a otro host —la base
    /// de Supabase de producción, por ejemplo—, el runtime no persiste ni despliega nada.
    ///
    /// Llevar SHADOW a una base remota es una decisión del owner, no un cambio de configuración: exige
    /// cambiar este guard.
    /// </summary>
    public static class ShadowPersistenceGuard
    {
        /// <summary>null si la cadena apunta a una base local; si no, por qué no se puede usar.</summary>
        public static string? RejectReason(string? connectionString)
        {
            if (string.IsNullOrWhiteSpace(connectionString))
                return "la API no tiene base configurada (ConnectionStrings:GaleCore)";

            string? host;
            try { host = new NpgsqlConnectionStringBuilder(connectionString).Host; }
            catch (ArgumentException) { return "la cadena de conexión no se puede leer"; }

            if (string.IsNullOrWhiteSpace(host))
                return "la cadena de conexión no dice a qué host conectarse";
            // Un host con varios destinos (failover de Npgsql) se acepta sólo si todos son locales.
            var remote = host.Split(',').Select(HostOf).Where(h => !IsLoopback(h)).ToList();
            return remote.Count == 0
                ? null
                : $"la base configurada no es local ({string.Join(", ", remote)}); SHADOW persiste sólo en el entorno de desarrollo aislado";
        }

        /// <summary>El host de una entrada "host", "host:puerto", "[ipv6]:puerto" o "ipv6".</summary>
        private static string HostOf(string entry)
        {
            var e = entry.Trim();
            if (e.StartsWith('[') && e.IndexOf(']') > 0) return e[1..e.IndexOf(']')];
            return e.Count(c => c == ':') == 1 ? e.Split(':')[0] : e;
        }

        private static bool IsLoopback(string host)
            => host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
               || (IPAddress.TryParse(host, out var ip) && IPAddress.IsLoopback(ip));
    }
}
