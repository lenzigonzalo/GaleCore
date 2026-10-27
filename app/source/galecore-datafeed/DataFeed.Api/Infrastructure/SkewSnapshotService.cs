using System.Text.Json.Nodes;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.PutSkew;
using DataFeed.Application.App.Shared;
using MediatR;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Servicio hosted que persiste un snapshot diario del skew25 por símbolo a
    /// Files/skew25_history.json. Es la fuente de historia que el gate tail_score usa para el
    /// RoC 5d (research: skew25 / skew25.shift(5) - 1). Registra a lo sumo un valor por día y símbolo;
    /// sobrevive reinicios (archivo). Formato: { "SPY": [ {"date":"2026-07-27","skew25":1.16}, ... ] }.
    /// </summary>
    public class SkewSnapshotService : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IWebHostEnvironment _env;
        private readonly PlatformServiceSwitch _switch;
        private readonly ILogger<SkewSnapshotService> _logger;
        private static readonly object _fileLock = new();

        private static readonly string[] Symbols = { "SPY", "QQQ" };
        private const int CheckIntervalMs = 6 * 60 * 60 * 1000; // 6h
        private const int MaxHistory = 90;

        /// <summary>
        /// Plazo sobre el que se mide el skew. Fijo a proposito: la serie tiene que ser comparable
        /// consigo misma, y el skew depende del DTE. Ver GammaExposureRequest.TargetDte.
        /// </summary>
        private const int TargetDte = 30;

        // Id declarado en services[] de galecore_rules_core.json.
        private const string ServiceId = "skew";

        private bool _inertLogged;

        public SkewSnapshotService(IServiceScopeFactory scopeFactory, IWebHostEnvironment env,
            PlatformServiceSwitch @switch, ILogger<SkewSnapshotService> logger)
        {
            _scopeFactory = scopeFactory;
            _env = env;
            _switch = @switch;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("SkewSnapshotService iniciado — snapshot diario de skew25 ({Symbols})", string.Join(",", Symbols));
            // Pequeño delay inicial para que DXLink complete el handshake.
            try { await Task.Delay(TimeSpan.FromSeconds(45), stoppingToken); } catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    // Se relee en cada tick, como el switch de las estrategias: apagarlo desde el
                    // front corta el barrido sin reiniciar la API. No hay estado publicado que
                    // limpiar — lo que este servicio produce es un archivo, y los días ya
                    // registrados siguen siendo válidos.
                    if (!_switch.IsEnabled(ServiceId))
                    {
                        if (!_inertLogged)
                        {
                            _logger.LogInformation(
                                "SkewSnapshotService INERTE: switch en OFF. Cada tick que pase sin registrar " +
                                "es un hueco en skew25_history.json, que es de donde sale el RoC 5d del gate " +
                                "tail_score de RPF.");
                            _inertLogged = true;
                        }
                    }
                    else
                    {
                        _inertLogged = false;
                        await SnapshotIfNeededAsync(stoppingToken);
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception ex) { _logger.LogError(ex, "Error en SkewSnapshotService tick"); }

                try { await Task.Delay(CheckIntervalMs, stoppingToken); } catch (OperationCanceledException) { break; }
            }
            _logger.LogInformation("SkewSnapshotService detenido");
        }

        private async Task SnapshotIfNeededAsync(CancellationToken ct)
        {
            // La fecha es la de NUEVA YORK, no la UTC. Con DateTime.UtcNow, un tick entre las 20:00
            // ET y la medianoche se registraba con la fecha del día siguiente. Es lo que llenó de
            // basura el fin de semana del 2026-08-22: quedó un punto fechado el domingo 23 y otro
            // el lunes 24 con el MISMO valor a cuatro decimales en los dos símbolos, o sea el mismo
            // dato viejo escrito dos veces.
            var hoyEt = CascadeUtils.TodayEt();

            // Y no se registra en día no hábil. El servicio tickea cada 6h sin mirar el calendario,
            // y con el mercado cerrado la cadena sigue respondiendo con lo último que vio: skew25
            // sale > 0, pasa la guarda de abajo, y se persiste un punto que no es una sesión.
            // Cubre sábado y domingo; los feriados siguen siendo un agujero y los ataja la guarda
            // de valor repetido.
            if (hoyEt.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)
                return;

            var today = hoyEt.ToString("yyyy-MM-dd");
            var path = Path.Combine(_env.ContentRootPath, "Files", "skew25_history.json");

            using var scope = _scopeFactory.CreateScope();
            var mediator = scope.ServiceProvider.GetRequiredService<IMediator>();

            foreach (var sym in Symbols)
            {
                if (AlreadyRecorded(path, sym, today)) continue;

                // TargetDte fija el plazo medido. Sin él, el handler devolvía el Regular de MAYOR
                // DTE dentro de 60, que salta de vencimiento una vez por mes y hace que la serie
                // no sea comparable consigo misma. Con Weekly habilitado, el más cercano a 30 DTE
                // se mantiene a pocos días del objetivo en vez de recorrer de 30 a 60.
                var gex = await mediator.Send(new GammaExposureRequest
                {
                    Symbol = sym,
                    MaxDTE = 60,
                    TargetDte = TargetDte,
                    ExpirationTypes = new[] { "Regular", "Weekly" },
                }, ct);

                double skew25 = PutSkewCalculator.Compute(gex).PutSkew25d ?? 0;
                if (skew25 <= 0)
                {
                    _logger.LogWarning("SkewSnapshot {Sym}: skew25 no resuelto (mercado cerrado o sin IV); se reintenta próximo tick", sym);
                    continue;
                }

                double redondeado = Math.Round(skew25, 4);

                // Un valor idéntico al del punto anterior es dato congelado, no una medición nueva.
                // Es lo que ataja los feriados, que el filtro de fin de semana no ve.
                if (LastValue(path, sym) is double ultimo && ultimo == redondeado)
                {
                    _logger.LogWarning(
                        "SkewSnapshot {Sym}: skew25={Skew} es idéntico al último punto; se descarta por " +
                        "dato congelado (¿feriado o feed detenido?) y se reintenta próximo tick", sym, redondeado);
                    continue;
                }

                // El vencimiento y el DTE viajan CON el punto. Sin eso, un cambio de plazo es
                // indistinguible de un movimiento de mercado, que es exactamente lo que pasó el
                // 2026-08-18 y nadie pudo ver hasta que se reconstruyó a mano.
                Append(path, sym, today, redondeado, gex.Expiration, gex.DTE);
                _logger.LogInformation("SkewSnapshot {Sym} {Date}: skew25={Skew} sobre {Exp} (DTE {Dte})",
                    sym, today, redondeado, gex.Expiration, gex.DTE);
            }
        }

        /// <summary>Último skew25 registrado para el símbolo, o null si no hay ninguno.</summary>
        private static double? LastValue(string path, string symbol)
        {
            lock (_fileLock)
            {
                var arr = Load(path)[symbol]?.AsArray();
                if (arr == null || arr.Count == 0) return null;
                return arr[arr.Count - 1]?["skew25"]?.GetValue<double>();
            }
        }

        private static bool AlreadyRecorded(string path, string symbol, string date)
        {
            lock (_fileLock)
            {
                var root = Load(path);
                var arr = root[symbol]?.AsArray();
                if (arr == null) return false;
                foreach (var r in arr)
                    if ((string?)r?["date"] == date) return true;
                return false;
            }
        }

        private static void Append(string path, string symbol, string date, double skew25,
            string? expiration, int dte)
        {
            lock (_fileLock)
            {
                var root = Load(path);
                var arr = root[symbol]?.AsArray();
                if (arr == null) { arr = new JsonArray(); root[symbol] = arr; }

                arr.Add(new JsonObject
                {
                    ["date"] = date,
                    ["skew25"] = skew25,
                    ["expiration"] = expiration,
                    ["dte"] = dte,
                });

                // Recortar a los últimos MaxHistory (por orden de inserción, que es cronológico).
                while (arr.Count > MaxHistory) arr.RemoveAt(0);

                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.WriteAllText(path, root.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
            }
        }

        private static JsonObject Load(string path)
        {
            try
            {
                if (File.Exists(path))
                    return JsonNode.Parse(File.ReadAllText(path))?.AsObject() ?? new JsonObject();
            }
            catch { /* archivo corrupto: se reescribe limpio */ }
            return new JsonObject();
        }
    }
}
