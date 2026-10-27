using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>De dónde sale un dato y qué historia tiene (WS-0036, pestaña «Datos» de una estrategia).</summary>
    public record DataSourceInfo
    {
        public string Name { get; init; } = "";
        public string Source { get; init; } = "";
        /// <summary>«del momento», «calculado por el proveedor sobre historia», «serie histórica del proveedor», «calendario».</summary>
        public string Kind { get; init; } = "";
        /// <summary>Qué historia guarda GaleCore de este dato.</summary>
        public string History { get; init; } = "";
        /// <summary>Lo que conviene saber al usarlo; null si nada.</summary>
        public string? Note { get; init; }
        /// <summary>Ruta de GaleCore que lo sirve (WS-0057 C).</summary>
        public string Endpoint { get; init; } = "";
        /// <summary>Servicio de GaleCore que guarda su historia; null si no se guarda.</summary>
        public string? StoredBy { get; init; }
    }

    /// <summary>Un dato que usa la estrategia, de dónde sale y qué vio en su última evaluación.</summary>
    public record StrategyDataItem
    {
        public string Need { get; init; } = "";
        public string Capability { get; init; } = "";
        public string UsedFor { get; init; } = "";
        public string Source { get; init; } = "";
        public string Kind { get; init; } = "";
        public string History { get; init; } = "";
        public string? Note { get; init; }
        public string Endpoint { get; init; } = "";
        /// <summary>Cada cuánto lo lee esta estrategia en SHADOW.</summary>
        public string Frequency { get; init; } = "";
        /// <summary>Servicio que guarda su historia; null si es del momento y no se guarda.</summary>
        public string? StoredBy { get; init; }
        public string? GateId { get; init; }
        /// <summary>Último valor que vio la estrategia (sólo gates); null si nunca lo vio.</summary>
        public double? LastValue { get; init; }
        /// <summary>PASS | FAIL | NO_DATA | SKIPPED de la última evaluación; null si no es un gate o no hay evaluación.</summary>
        public string? LastStatus { get; init; }
        public DateTime? LastAt { get; init; }
    }

    public record StrategyDataReport
    {
        public DateTime AsOf { get; init; }
        public string Spec { get; init; } = "";
        public string? Version { get; init; }
        public DateTime? LastEvaluationAt { get; init; }
        public List<StrategyDataItem> Items { get; init; } = new();
        public string Storage { get; init; } = StrategyData.Storage;
    }

    /// <summary>
    /// Qué datos usa una estrategia SHADOW, de qué fuente y con qué historia. Función pura: el catálogo describe lo que
    /// hace hoy el código de GaleCore (verificado al escribirlo, 14/10/2026); lo que no está acá sale como «sin catálogo».
    /// </summary>
    public static class StrategyData
    {
        public const string Storage = "GaleCore guarda la historia del skew; el resto de lo histórico lo calcula el proveedor o se pide en el momento. "
            + "Los valores que vio cada estrategia sí quedan guardados en sus evaluaciones de SHADOW.";
        /// <summary>Cadencias del motor SHADOW (ShadowEntryLoopService, ShadowPositionMonitorService).</summary>
        public const string EntryCadence = "cada 60 s, al buscar entradas";
        public const string QuoteCadence = "cada 30 s con posiciones abiertas; cada 60 s al buscar entradas";

        private const string NotStored = "GaleCore no la guarda";

        public static readonly IReadOnlyDictionary<string, DataSourceInfo> Catalog = new Dictionary<string, DataSourceInfo>
        {
            ["market_data.quote"] = new() { Endpoint = "/Data/Tastytrade/MarketData/Quote", Name = "Cotización (bid, ask y hora)", Source = "Tastytrade (DXLink)", Kind = "del momento", History = NotStored },
            ["market_data.trade"] = new() { Endpoint = "/Data/Tastytrade/MarketData/Trade", Name = "Último precio", Source = "Tastytrade (DXLink)", Kind = "del momento", History = NotStored },
            ["market_data.option_chains"] = new() { Endpoint = "/Data/Tastytrade/OptionChains", Name = "Cadena de opciones (vencimientos y strikes)", Source = "Tastytrade", Kind = "del momento", History = NotStored },
            ["market_data.option_greeks"] = new() { Endpoint = "/Data/Tastytrade/MarketData/Greeks", Name = "Griegas por opción", Source = "Tastytrade (DXLink)", Kind = "del momento", History = NotStored },
            ["compute.gamma_exposure"] = new() { Endpoint = "/App.Analytics/GammaExposure", Name = "Gamma (GEX) y deltas por strike", Source = "Cálculo de GaleCore con griegas e interés abierto de Tastytrade", Kind = "del momento", History = NotStored },
            ["compute.gex_analysis"] = new() { Endpoint = "/App/Gex/Analysis", Name = "Análisis de GEX", Source = "Cálculo de GaleCore con griegas e interés abierto de Tastytrade", Kind = "del momento", History = NotStored },
            ["compute.iv_rank"] = new()
            { Endpoint = "/App.Analytics/IVRank",
                Name = "IV Rank", Source = "Tastytrade (market-metrics)", Kind = "calculado por el proveedor sobre historia", History = "No hace falta: Tastytrade lo calcula sobre 252 días",
                Note = "Es el IV Percentile de Tastytrade, usado como aproximación del IV Rank",
            },
            ["compute.implied_volatility"] = new() { Endpoint = "/App.Analytics/ImpliedVolatility", Name = "Volatilidad implícita", Source = "Cálculo de GaleCore con datos de Tastytrade", Kind = "del momento", History = NotStored },
            ["compute.put_skew"] = new()
            { Endpoint = "/App.Analytics/PutSkew", StoredBy = "Historia del skew (cada 6 h)",
                Name = "Skew 25Δ put", Source = "Cálculo de GaleCore con la IV por strike de Tastytrade", Kind = "del momento", History = "GaleCore guarda un valor cada 6 h",
                Note = "La serie diaria la guarda el servicio «Historia del skew» (Configuración → Plataforma)",
            },
            ["market_data.volatility_metrics"] = new() { Endpoint = "/Data/Tastytrade/Market-metrics/VolatilityData", Name = "Métricas de volatilidad", Source = "Tastytrade (market-metrics)", Kind = "calculado por el proveedor sobre historia", History = "No hace falta: las calcula el proveedor" },
            ["market_data.earnings_history"] = new() { Endpoint = "/Data/Tastytrade/Market-metrics/EarningsHistory", Name = "Historial de balances", Source = "Tastytrade (earnings-reports)", Kind = "serie histórica del proveedor", History = "Se pide al proveedor cada vez", Note = "El próximo balance y el consenso vienen en volatility_metrics (earnings); en ETF e índices no hay balance" },
            ["market_data.candles"] = new() { Endpoint = "/Data/Tastytrade/MarketData/Candle", Name = "Velas de precio", Source = "Tastytrade", Kind = "serie histórica del proveedor", History = "Se pide al proveedor cada vez" },
            ["history.index_daily"] = new() { Endpoint = "/Data/Cboe/IndexHistory", Name = "Historia diaria de índices", Source = "Cboe", Kind = "serie histórica del proveedor", History = "Se pide al proveedor cada vez" },
            ["rates.treasury_curve"] = new() { Endpoint = "/Data/Treasury/YieldCurve", Name = "Curva del Tesoro", Source = "Tesoro de EE. UU.", Kind = "serie histórica del proveedor", History = "Se pide al proveedor cada vez" },
            ["macro.fred_series"] = new() { Endpoint = "/Data/Fred/Series", Name = "Series macro", Source = "FRED", Kind = "serie histórica del proveedor", History = "Se pide al proveedor cada vez" },
            ["macro.bls_series"] = new() { Endpoint = "/Data/Bls/Series", Name = "Series de empleo y precios", Source = "BLS", Kind = "serie histórica del proveedor", History = "Se pide al proveedor cada vez" },
            ["calendar.macro_releases"] = new() { Endpoint = "/Data/Fred/ReleaseDates", Name = "Calendario de datos macro", Source = "FRED", Kind = "calendario", History = "Se pide al proveedor cada vez" },
            ["calendar.fomc_meetings"] = new() { Endpoint = "/Data/Fed/FomcMeetings", Name = "Reuniones de la Fed", Source = "Reserva Federal", Kind = "calendario", History = "Se pide al proveedor cada vez" },
            ["calendar.treasury_auctions"] = new() { Endpoint = "/Data/Treasury/Auctions/Upcoming", Name = "Subastas del Tesoro", Source = "Tesoro de EE. UU.", Kind = "calendario", History = "Se pide al proveedor cada vez" },
        };

        /// <summary>«capability:market_data.trade.VIX.price» → «market_data.trade» (la entrada más larga del catálogo que coincide).</summary>
        public static string? CapabilityOf(string metricRef)
        {
            var reference = metricRef.StartsWith("capability:") ? metricRef["capability:".Length..] : metricRef;
            return Catalog.Keys.Where(k => reference == k || reference.StartsWith(k + ".")).OrderByDescending(k => k.Length).FirstOrDefault();
        }

        public static StrategyDataReport Build(StrategySpec spec, EvaluationResult? lastEvaluation, DateTime now)
        {
            var items = new List<StrategyDataItem>();
            if (spec.CandidateConstruction.Legs.Count > 0)
            {
                items.Add(Item("market_data.option_chains", "Vencimientos, strikes y símbolos", "Armar el candidato", EntryCadence));
                items.Add(Item("compute.gamma_exposure", "Deltas por strike y vencimiento", "Elegir strikes por delta", EntryCadence));
                items.Add(Item("market_data.quote", "Bid, ask y hora por pata", "Crédito de entrada y valuación de las abiertas", QuoteCadence));
            }
            var results = lastEvaluation?.GateResults.ToDictionary(g => g.GateId) ?? new Dictionary<string, GateResult>();
            foreach (var gate in spec.EntryFilters.GateLayer.Gates.Concat(spec.EntryFilters.SignalLayer.Gates))
            {
                results.TryGetValue(gate.Id, out var seen);
                var capability = CapabilityOf(gate.MetricRef) ?? gate.MetricRef;
                items.Add(Item(capability, gate.Label, "Condición de entrada", EntryCadence) with
                {
                    GateId = gate.Id, LastValue = seen?.Value, LastStatus = seen?.Status,
                    LastAt = seen == null ? null : lastEvaluation!.EvaluatedAt,
                });
            }
            return new StrategyDataReport
            {
                AsOf = now, Spec = spec.Identity.Name, Version = spec.Identity.Version, LastEvaluationAt = lastEvaluation?.EvaluatedAt, Items = items,
            };
        }

        private static StrategyDataItem Item(string capability, string need, string usedFor, string frequency)
        {
            Catalog.TryGetValue(capability, out var info);
            return new StrategyDataItem
            {
                Need = need, Capability = capability, UsedFor = usedFor, Frequency = frequency,
                Endpoint = info?.Endpoint ?? "", StoredBy = info?.StoredBy,
                Source = info?.Source ?? "sin catálogo", Kind = info?.Kind ?? "sin catálogo",
                History = info?.History ?? "sin catálogo", Note = info?.Note,
            };
        }
    }
}
