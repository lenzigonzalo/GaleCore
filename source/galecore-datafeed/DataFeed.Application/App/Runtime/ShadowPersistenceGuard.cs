namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Cuándo persiste el runtime SHADOW (GC-0004, AC-03). Es un interruptor EXPLÍCITO por entorno,
    /// `Runtime:Persistence:Enabled`, apagado por defecto en appsettings.json:
    ///   * en el entorno de desarrollo aislado (proyecto Supabase "GaleCore Dev") se prende;
    ///   * en producción queda apagado hasta que el owner apruebe llevar SHADOW ahí y la migración
    ///     AddShadowRuntime esté aplicada (decisión del owner, 24/09). Prenderlo es el paso de despliegue.
    /// Apagado, o sin base configurada, el runtime no persiste ni despliega nada (503 con el motivo).
    /// </summary>
    public static class ShadowPersistenceGuard
    {
        public const string EnabledKey = "Runtime:Persistence:Enabled";

        /// <summary>null si el runtime puede persistir; si no, por qué.</summary>
        public static string? RejectReason(bool enabled, string? connectionString)
        {
            if (!enabled)
                return $"la persistencia de SHADOW está apagada en este entorno ({EnabledKey} = false)";
            if (string.IsNullOrWhiteSpace(connectionString))
                return "la API no tiene base configurada (ConnectionStrings:GaleCore)";
            return null;
        }
    }
}
