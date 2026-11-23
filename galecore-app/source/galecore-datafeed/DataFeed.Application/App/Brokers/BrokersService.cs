using System.Text.Json;
using DataFeed.Application.App.Connections;
using DataFeed.Infrastructure.Providers.Iol;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

namespace DataFeed.Application.App.Brokers
{
    public sealed class BrokerCheckView
    {
        public DateTime At { get; set; }
        public bool Ok { get; set; }
        public string Message { get; set; } = "";
    }

    /// <summary>Una fila de Configuración › Conexiones › Brokers. Nunca lleva credenciales, sólo el hint.</summary>
    public sealed class BrokerView
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";

        /// <summary>connected | missing | invalid | soon</summary>
        public string Status { get; set; } = "";

        /// <summary>¿Entra en la cartera consolidada?</summary>
        public bool Include { get; set; } = true;

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string? Hint { get; set; }

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public BrokerCheckView? LastCheck { get; set; }

        public string Description { get; set; } = "";
    }

    public sealed record BrokerTestResult(bool Ok, string Status, string Message, DateTime At);

    public enum BrokerWriteOutcome { Ok, UnknownBroker, Invalid, Rejected, StorageUnavailable }

    /// <summary>
    /// Brokers del usuario en la cartera consolidada (WS-0108): estado, interruptor «incluir», credencial de IOL (cifrada con
    /// <see cref="ITokenProtector"/>, probada contra IOL antes de guardar), prueba de conexión y la cartera de IOL.
    /// Tastytrade sigue con su credencial en <c>accounts</c>. Nada de lo que devuelve ni loguea incluye contraseñas ni tokens.
    /// Sin base la API arranca igual: la lista sale con todo «missing» y las escrituras contestan «storage no disponible».
    /// </summary>
    public sealed class BrokersService
    {
        public const string Tastytrade = "tastytrade";
        public const string Ibkr = "ibkr";
        public const string Iol = "iol";
        public const int MaxFieldLength = 200;

        private readonly IBrokerStore? _store;
        private readonly ITokenProtector _protector;
        private readonly IIolClient _iol;
        private readonly Func<CancellationToken, Task>? _tastytradeProbe;
        private readonly ILogger<BrokersService> _logger;
        private readonly Func<DateTime> _now;

        /// <param name="tastytradeProbe">Lee los balances de Tastytrade del usuario actual (el mismo handler de Data/Tastytrade/Account/Balances).</param>
        public BrokersService(IBrokerStore? store, ITokenProtector protector, IIolClient iol,
            Func<CancellationToken, Task>? tastytradeProbe, ILogger<BrokersService> logger, Func<DateTime>? now = null)
        {
            _store = store;
            _protector = protector;
            _iol = iol;
            _tastytradeProbe = tastytradeProbe;
            _logger = logger;
            _now = now ?? (() => DateTime.UtcNow);
        }

        /// <summary>Hay base y la clave de cifrado sirve.</summary>
        public bool StorageReady()
        {
            if (_store == null) return false;
            try { _protector.Unprotect(_protector.Protect("x")); return true; }
            catch (Exception) { return false; }
        }

        // ── lista ─────────────────────────────────────────────────────────────────────────────────────────────

        public async Task<List<BrokerView>> ListAsync(Guid userId, CancellationToken ct)
        {
            var rows = await LoadRowsAsync(userId, ct);
            var list = new List<BrokerView>();
            foreach (var def in ConnectionCatalog.All.Where(c => c.Kind == ConnectionKind.Broker))
                list.Add(await BuildViewAsync(def, userId, rows, ct));
            return list;
        }

        public async Task<BrokerView?> GetAsync(Guid userId, string id, CancellationToken ct)
        {
            var def = FindBroker(id);
            return def == null ? null : await BuildViewAsync(def, userId, await LoadRowsAsync(userId, ct), ct);
        }

        private async Task<Dictionary<string, UserBrokerRow>> LoadRowsAsync(Guid userId, CancellationToken ct)
        {
            var rows = new Dictionary<string, UserBrokerRow>(StringComparer.OrdinalIgnoreCase);
            if (_store == null) return rows;
            try { foreach (var r in await _store.LoadAsync(userId, ct)) rows[r.Broker] = r; }
            catch (Exception ex) { _logger.LogWarning("Brokers: no se pudo leer la tabla ({Type}).", ex.GetType().Name); }
            return rows;
        }

        private async Task<BrokerView> BuildViewAsync(ConnectionDefinition def, Guid userId, Dictionary<string, UserBrokerRow> rows, CancellationToken ct)
        {
            rows.TryGetValue(def.Id, out var row);
            var view = new BrokerView
            {
                Id = def.Id,
                Name = def.Name,
                Description = def.Description,
                Include = row?.Include ?? true,
            };
            if (row?.LastCheckAt != null && row.LastCheckOk != null)
                view.LastCheck = new BrokerCheckView { At = row.LastCheckAt.Value, Ok = row.LastCheckOk.Value, Message = row.LastCheckMessage ?? "" };
            var failed = view.LastCheck is { Ok: false };

            switch (def.Id)
            {
                case Tastytrade:
                    var linked = false;
                    if (_store != null)
                    {
                        try { linked = await _store.HasTastytradeAccountAsync(userId, ct); }
                        catch (Exception ex) { _logger.LogWarning("Brokers: no se pudo leer las cuentas ({Type}).", ex.GetType().Name); }
                    }
                    view.Status = !linked ? "missing" : failed ? "invalid" : "connected";
                    break;
                case Iol:
                    var has = !string.IsNullOrEmpty(row?.SecretCipher);
                    view.Status = !has ? "missing" : failed ? "invalid" : "connected";
                    if (has) view.Hint = row!.SecretHint;
                    break;
                default:
                    view.Status = "soon";
                    break;
            }
            return view;
        }

        private static ConnectionDefinition? FindBroker(string id)
        {
            var def = ConnectionCatalog.Find(id);
            return def?.Kind == ConnectionKind.Broker ? def : null;
        }

        // ── escrituras ────────────────────────────────────────────────────────────────────────────────────────

        /// <summary>«••1a2b»: últimos 4 del usuario de IOL, sólo si tiene 8 o más caracteres.</summary>
        public static string? Hint(string username) => PlatformConnectionsService.Hint(username);

        /// <summary>
        /// Prueba el login en IOL y, sólo si anda, guarda usuario y contraseña cifrados. Si IOL lo rechaza no guarda nada y
        /// el mensaje es el motivo. Una caída de IOL sale como <see cref="DataFeed.Infrastructure.Providers.UpstreamSourceException"/>.
        /// </summary>
        public async Task<(BrokerWriteOutcome Outcome, string? Message)> SetIolCredentialsAsync(
            Guid userId, string? username, string? password, CancellationToken ct)
        {
            var user = username?.Trim();
            if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(password) || user.Length > MaxFieldLength || password.Length > MaxFieldLength)
                return (BrokerWriteOutcome.Invalid, "El usuario y la contraseña son obligatorios.");
            if (!StorageReady()) return (BrokerWriteOutcome.StorageUnavailable, "No se pueden guardar credenciales en este servidor.");

            var credentials = new IolCredentials(user, password);
            _iol.Forget(userId);
            try { await _iol.LoginAsync(userId, credentials, ct); }
            catch (IolCredentialInvalidException ex) { return (BrokerWriteOutcome.Rejected, ex.Message); }

            var cipher = _protector.Protect(System.Text.Json.JsonSerializer.Serialize(new { username = user, password }));
            var now = _now();
            await _store!.SaveSecretAsync(userId, Iol, cipher, Hint(user), now, ct);
            await _store.SaveCheckAsync(userId, Iol, now, true, "IOL aceptó el usuario y la contraseña.", ct);
            _logger.LogInformation("Credencial de IOL cargada por {UserId}.", userId);
            return (BrokerWriteOutcome.Ok, null);
        }

        public async Task<BrokerWriteOutcome> DeleteIolCredentialsAsync(Guid userId, CancellationToken ct)
        {
            if (_store == null) return BrokerWriteOutcome.StorageUnavailable;
            await _store.ClearSecretAsync(userId, Iol, _now(), ct);
            _iol.Forget(userId);
            _logger.LogInformation("Credencial de IOL borrada por {UserId}.", userId);
            return BrokerWriteOutcome.Ok;
        }

        public async Task<BrokerWriteOutcome> SetIncludeAsync(Guid userId, string id, bool include, CancellationToken ct)
        {
            var def = FindBroker(id);
            if (def == null) return BrokerWriteOutcome.UnknownBroker;
            if (_store == null) return BrokerWriteOutcome.StorageUnavailable;
            await _store.SetIncludeAsync(userId, def.Id, include, _now(), ct);
            return BrokerWriteOutcome.Ok;
        }

        // ── prueba ────────────────────────────────────────────────────────────────────────────────────────────

        /// <summary>Null si el id no es de un broker. Tastytrade: lee balances; IOL: token y saldos. Guarda el resultado.</summary>
        public async Task<BrokerTestResult?> TestAsync(Guid userId, string id, CancellationToken ct)
        {
            var def = FindBroker(id);
            if (def == null) return null;
            var at = _now();
            BrokerTestResult result;
            try
            {
                result = def.Id switch
                {
                    Tastytrade => await TestTastytradeAsync(at, ct),
                    Iol => await TestIolAsync(userId, at, ct),
                    _ => new BrokerTestResult(false, "soon", $"{def.Name} todavía no se puede conectar.", at),
                };
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                result = new BrokerTestResult(false, "invalid", $"{def.Name}: sin respuesta.", at);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Mensaje de la fuente (sin credenciales): el handler de Tastytrade lo envuelve y IOL ya lo arma sin ellas.
                result = new BrokerTestResult(false, "invalid", ex.Message, at);
            }

            if (_store != null && result.Status != "soon" && result.Status != "missing")
            {
                try { await _store.SaveCheckAsync(userId, def.Id, at, result.Ok, result.Message, ct); }
                catch (Exception ex) { _logger.LogWarning("Brokers: no se pudo guardar la prueba de {Id} ({Type}).", def.Id, ex.GetType().Name); }
            }
            return result;
        }

        private async Task<BrokerTestResult> TestTastytradeAsync(DateTime at, CancellationToken ct)
        {
            if (_tastytradeProbe == null) return new BrokerTestResult(false, "invalid", "Tastytrade no está disponible en este servidor.", at);
            try
            {
                await _tastytradeProbe(ct);
                return new BrokerTestResult(true, "connected", "Tastytrade respondió bien.", at);
            }
            catch (BrokerAccountNotLinkedException)
            {
                return new BrokerTestResult(false, "missing", "Todavía no vinculaste tu cuenta de Tastytrade.", at);
            }
            catch (BrokerCredentialInvalidException ex)
            {
                return new BrokerTestResult(false, "invalid", ex.Message, at);
            }
        }

        private async Task<BrokerTestResult> TestIolAsync(Guid userId, DateTime at, CancellationToken ct)
        {
            var credentials = await LoadIolCredentialsAsync(userId, ct);
            if (credentials == null) return new BrokerTestResult(false, "missing", "Todavía no cargaste tu usuario de IOL.", at);
            try
            {
                await _iol.GetBalancesAsync(userId, credentials, "AR", ct);
                return new BrokerTestResult(true, "connected", "IOL respondió bien.", at);
            }
            catch (IolCredentialInvalidException ex)
            {
                return new BrokerTestResult(false, "invalid", ex.Message, at);
            }
        }

        // ── cartera de IOL ────────────────────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Saldos y posiciones de IOL (AR y US) en la forma de GaleCore. <see cref="BrokerAccountNotLinkedException"/> si el
        /// usuario no cargó su credencial; <see cref="IolCredentialInvalidException"/> si IOL la rechaza; una caída de IOL sale
        /// como <see cref="DataFeed.Infrastructure.Providers.UpstreamSourceException"/>.
        /// </summary>
        public async Task<IolPortfolioResponse> GetIolPortfolioAsync(Guid userId, CancellationToken ct)
        {
            var credentials = await LoadIolCredentialsAsync(userId, ct) ?? throw new BrokerAccountNotLinkedException();
            var asOf = _now();
            var arBalances = await _iol.GetBalancesAsync(userId, credentials, "AR", ct);
            var usBalances = await _iol.GetBalancesAsync(userId, credentials, "US", ct);
            var arPositions = await _iol.GetPositionsAsync(userId, credentials, "AR", ct);
            var usPositions = await _iol.GetPositionsAsync(userId, credentials, "US", ct);
            return IolPortfolioMapper.Map(asOf, arBalances, usBalances, arPositions, usPositions);
        }

        /// <summary>Null si no hay credencial guardada (o no se puede leer: se trata como no vinculada).</summary>
        private async Task<IolCredentials?> LoadIolCredentialsAsync(Guid userId, CancellationToken ct)
        {
            if (_store == null) return null;
            var row = (await _store.LoadAsync(userId, ct)).FirstOrDefault(r => r.Broker == Iol);
            if (string.IsNullOrEmpty(row?.SecretCipher)) return null;
            try
            {
                using var doc = JsonDocument.Parse(_protector.Unprotect(row.SecretCipher));
                var user = doc.RootElement.GetProperty("username").GetString();
                var pass = doc.RootElement.GetProperty("password").GetString();
                return string.IsNullOrEmpty(user) || string.IsNullOrEmpty(pass) ? null : new IolCredentials(user, pass);
            }
            catch (Exception)
            {
                _logger.LogWarning("Brokers: no se pudo descifrar la credencial de IOL de {UserId}.", userId);
                return null;
            }
        }
    }
}
