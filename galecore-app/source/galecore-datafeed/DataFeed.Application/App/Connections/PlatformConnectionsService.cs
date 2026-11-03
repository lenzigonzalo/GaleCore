using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

namespace DataFeed.Application.App.Connections
{
    public sealed class ConnectionTestView
    {
        public DateTime At { get; set; }
        public bool Ok { get; set; }
        public string Message { get; set; } = "";
    }

    /// <summary>Una entrada de la lista. Nunca lleva el valor de la clave, sólo el hint.</summary>
    public sealed class ConnectionView
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string Kind { get; set; } = "";
        public string Owner { get; set; } = "";
        public string NeedsKey { get; set; } = "";

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string? KeyLabel { get; set; }

        /// <summary>connected | missing | not-needed | error | local</summary>
        public string Status { get; set; } = "";

        /// <summary>"database" | "server" | null (sin valor).</summary>
        public string? Origin { get; set; }

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string? Hint { get; set; }

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public DateTime? UpdatedAt { get; set; }

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string? UpdatedBy { get; set; }

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public ConnectionTestView? LastTest { get; set; }

        public string Description { get; set; } = "";

        /// <summary>"Estados Unidos" | "Argentina" | null: para que el front agrupe.</summary>
        public string? Group { get; set; }
    }

    public sealed class ConnectionsListView
    {
        public bool CanEdit { get; set; }
        public bool StorageReady { get; set; }

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string? StorageMessage { get; set; }

        public List<ConnectionView> Connections { get; set; } = new();
    }

    public enum SetKeyOutcome { Ok, UnknownConnection, NotEditable, Invalid, StorageUnavailable }

    /// <summary>
    /// Claves de conexión de la plataforma (WS-0080): carga y descifra <c>platform_connections</c> en la fuente de
    /// configuración en memoria, guarda/borra y arma la lista. Nada de lo que devuelve ni loguea incluye el valor.
    ///
    /// Sin base, sin clave de cifrado o con una fila que no descifra, la API arranca igual: se avisa en el log (sin valores)
    /// y manda la configuración del servidor.
    /// </summary>
    public sealed class PlatformConnectionsService
    {
        public const int MaxValueLength = 512;

        private readonly IConfiguration _config;
        private readonly PlatformSecretsProvider _provider;
        private readonly IPlatformConnectionStore? _store;
        private readonly ITokenProtector _protector;
        private readonly IHttpClientFactory _http;
        private readonly ILogger<PlatformConnectionsService> _logger;

        public PlatformConnectionsService(IConfiguration config, PlatformSecretsConfigurationSource source,
            IPlatformConnectionStore? store, ITokenProtector protector, IHttpClientFactory http,
            ILogger<PlatformConnectionsService> logger)
        {
            _config = config;
            _provider = source.Provider;
            _store = store;
            _protector = protector;
            _http = http;
            _logger = logger;
        }

        /// <summary>Hay base y la clave de cifrado sirve; si no, el motivo para mostrar en la pantalla.</summary>
        public (bool Ready, string? Message) Storage()
        {
            if (_store == null) return (false, "No hay base de datos configurada: las claves se leen sólo de la configuración del servidor.");
            try { _protector.Unprotect(_protector.Protect("x")); return (true, null); }
            catch (Exception) { return (false, "Falta o es inválida la clave de cifrado del servidor (Security:TokenProtectionKey): no se pueden guardar claves."); }
        }

        /// <summary>Carga inicial al arrancar. Nunca tira: cualquier problema es un warning sin valores.</summary>
        public async Task LoadAsync(CancellationToken ct = default)
        {
            if (_store == null) { _logger.LogWarning("Claves de conexión: sin base, se usa sólo la configuración del servidor."); return; }
            var (ready, message) = Storage();
            if (!ready) { _logger.LogWarning("Claves de conexión: {Reason}", message); return; }

            IReadOnlyList<PlatformConnectionRow> rows;
            try { rows = await _store.LoadAllAsync(ct); }
            catch (Exception ex)
            {
                _logger.LogWarning("Claves de conexión: no se pudo leer la tabla ({Type}); se usa la configuración del servidor.", ex.GetType().Name);
                return;
            }

            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var row in rows.Where(r => r.SecretCipher != null))
            {
                var def = ConnectionCatalog.Find(row.ConnectionId);
                if (def?.ConfigKey == null) continue;
                try { values[def.ConfigKey] = _protector.Unprotect(row.SecretCipher!); }
                catch (Exception)
                {
                    _logger.LogWarning("Claves de conexión: no se pudo descifrar la de {Id}; se usa la del servidor.", row.ConnectionId);
                }
            }
            _provider.Replace(values);
            _logger.LogInformation("Claves de conexión: {Count} cargadas desde la base.", values.Count);
        }

        public async Task<ConnectionsListView> ListAsync(Guid? userId, bool canEdit, CancellationToken ct)
        {
            var (ready, message) = Storage();
            var rows = new Dictionary<string, PlatformConnectionRow>(StringComparer.OrdinalIgnoreCase);
            if (_store != null)
            {
                try { foreach (var r in await _store.LoadAllAsync(ct)) rows[r.ConnectionId] = r; }
                catch (Exception ex) { _logger.LogWarning("Conexiones: no se pudo leer la tabla ({Type}).", ex.GetType().Name); }
            }

            var view = new ConnectionsListView { CanEdit = canEdit, StorageReady = ready, StorageMessage = message };
            foreach (var def in ConnectionCatalog.All)
            {
                rows.TryGetValue(def.Id, out var row);
                var item = new ConnectionView
                {
                    Id = def.Id,
                    Name = def.Name,
                    Kind = def.Kind.ToString().ToLowerInvariant(),
                    Owner = def.Owner.ToString().ToLowerInvariant(),
                    NeedsKey = def.Needs.ToString().ToLowerInvariant(),
                    KeyLabel = def.KeyLabel,
                    Description = def.Description,
                    Group = def.Group,
                };
                if (def.Kind == ConnectionKind.Mcp) item.Status = "local";
                else if (def.Kind == ConnectionKind.Broker) await FillBrokerAsync(item, userId, ct);
                else if (def.Needs == KeyNeed.None) item.Status = "not-needed";
                else FillPlatformSecret(item, def, row);
                view.Connections.Add(item);
            }
            return view;
        }

        private void FillPlatformSecret(ConnectionView item, ConnectionDefinition def, PlatformConnectionRow? row)
        {
            var fromDb = _provider.Has(def.ConfigKey!);
            var value = _config[def.ConfigKey!];
            var hasValue = !string.IsNullOrWhiteSpace(value);
            if (hasValue)
            {
                item.Origin = fromDb ? "database" : "server";
                item.Hint = fromDb ? row?.SecretHint ?? Hint(value!) : Hint(value!);
                if (fromDb && row != null)
                {
                    item.UpdatedAt = row.UpdatedAt;
                    item.UpdatedBy = row.UpdatedByName ?? row.UpdatedBy?.ToString();
                }
            }
            if (row?.LastTestAt != null && row.LastTestOk != null && hasValue)
                item.LastTest = new ConnectionTestView { At = row.LastTestAt.Value, Ok = row.LastTestOk.Value, Message = row.LastTestMessage ?? "" };

            item.Status = !hasValue ? "missing" : item.LastTest is { Ok: false } ? "error" : "connected";
            if (!hasValue && def.Needs == KeyNeed.Optional)
                item.Description = def.Description + " Sin clave anda con límites bajos.";
        }

        private async Task FillBrokerAsync(ConnectionView item, Guid? userId, CancellationToken ct)
        {
            var linked = false;
            if (_store != null && userId != null)
            {
                try { linked = await _store.HasBrokerAccountAsync(userId.Value, ct); }
                catch (Exception ex) { _logger.LogWarning("Conexiones: no se pudo leer las cuentas ({Type}).", ex.GetType().Name); }
            }
            item.Status = linked ? "connected" : "missing";
        }

        /// <summary>«••1a2b»: últimos 4, sólo si el valor tiene 8 o más caracteres.</summary>
        public static string? Hint(string value) => value.Length >= 8 ? "••" + value[^4..] : null;

        public async Task<SetKeyOutcome> SetKeyAsync(string id, string? rawValue, Guid? userId, CancellationToken ct)
        {
            var def = ConnectionCatalog.Find(id);
            if (def == null) return SetKeyOutcome.UnknownConnection;
            if (!ConnectionCatalog.IsEditable(def)) return SetKeyOutcome.NotEditable;
            var value = rawValue?.Trim();
            if (string.IsNullOrEmpty(value) || value.Length > MaxValueLength) return SetKeyOutcome.Invalid;
            if (!Storage().Ready) return SetKeyOutcome.StorageUnavailable;

            var cipher = _protector.Protect(value);
            await _store!.UpsertSecretAsync(def.Id, cipher, Hint(value), userId, DateTime.UtcNow, ct);
            _provider.SetValue(def.ConfigKey!, value);
            _logger.LogInformation("Clave de {Id} cambiada por {UserId}.", def.Id, userId);
            return SetKeyOutcome.Ok;
        }

        public async Task<SetKeyOutcome> DeleteKeyAsync(string id, Guid? userId, CancellationToken ct)
        {
            var def = ConnectionCatalog.Find(id);
            if (def == null) return SetKeyOutcome.UnknownConnection;
            if (!ConnectionCatalog.IsEditable(def)) return SetKeyOutcome.NotEditable;
            if (_store == null) return SetKeyOutcome.StorageUnavailable;

            await _store.DeleteAsync(def.Id, ct);
            _provider.Remove(def.ConfigKey!);
            _logger.LogInformation("Clave de {Id} borrada de la base por {UserId}; vuelve la del servidor.", def.Id, userId);
            return SetKeyOutcome.Ok;
        }

        /// <summary>Prueba la conexión con el valor efectivo y, si hay base, guarda el resultado. Null si el id no existe o no se prueba.</summary>
        public async Task<ConnectionTestResult?> TestAsync(string id, CancellationToken ct)
        {
            var def = ConnectionCatalog.Find(id);
            if (def == null) return null;
            if (!ConnectionCatalog.IsEditable(def))
                return new ConnectionTestResult(false, $"{def.Name} no tiene una clave que probar.", DateTime.UtcNow);

            var value = _config[def.ConfigKey!];
            var result = await ConnectionTester.RunAsync(def.Id, value, _http.CreateClient(), ct);
            if (_store != null && !string.IsNullOrWhiteSpace(value))
            {
                try { await _store.SaveTestAsync(def.Id, result.At, result.Ok, result.Message, ct); }
                catch (Exception ex) { _logger.LogWarning("Conexiones: no se pudo guardar la prueba de {Id} ({Type}).", def.Id, ex.GetType().Name); }
            }
            return result;
        }

        /// <summary>Entrada de una sola conexión (respuesta del PUT).</summary>
        public async Task<ConnectionView?> GetAsync(string id, Guid? userId, bool canEdit, CancellationToken ct) =>
            (await ListAsync(userId, canEdit, ct)).Connections.FirstOrDefault(c => c.Id == id);
    }
}
