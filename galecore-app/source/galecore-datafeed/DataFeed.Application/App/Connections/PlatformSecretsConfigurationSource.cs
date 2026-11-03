using Microsoft.Extensions.Configuration;

namespace DataFeed.Application.App.Connections
{
    /// <summary>
    /// Fuente de configuración en memoria con los valores descifrados de <c>platform_connections</c> (WS-0080). Se agrega
    /// ÚLTIMA a <c>builder.Configuration</c>: si hay un valor acá, gana sobre <c>datafeed.env</c>; si no, manda el servidor.
    /// Los proveedores (FRED, BLS, SEC) siguen leyendo <c>config["..."]</c> por pedido y ven el cambio sin reiniciar.
    /// </summary>
    public sealed class PlatformSecretsConfigurationSource : IConfigurationSource
    {
        public PlatformSecretsProvider Provider { get; } = new();

        public IConfigurationProvider Build(IConfigurationBuilder builder) => Provider;
    }

    public sealed class PlatformSecretsProvider : ConfigurationProvider
    {
        private readonly object _gate = new();

        /// <summary>¿Hay valor propio de la base para esta clave de configuración?</summary>
        public bool Has(string configKey)
        {
            lock (_gate) return Data.ContainsKey(configKey);
        }

        public void SetValue(string configKey, string value)
        {
            lock (_gate) Data = new Dictionary<string, string?>(Data, StringComparer.OrdinalIgnoreCase) { [configKey] = value };
            OnReload();
        }

        public void Remove(string configKey)
        {
            lock (_gate)
            {
                var copy = new Dictionary<string, string?>(Data, StringComparer.OrdinalIgnoreCase);
                copy.Remove(configKey);
                Data = copy;
            }
            OnReload();
        }

        /// <summary>Reemplaza todo de una vez (carga inicial).</summary>
        public void Replace(IDictionary<string, string> values)
        {
            lock (_gate)
                Data = new Dictionary<string, string?>(values.ToDictionary(kv => kv.Key, kv => (string?)kv.Value), StringComparer.OrdinalIgnoreCase);
            OnReload();
        }
    }
}
