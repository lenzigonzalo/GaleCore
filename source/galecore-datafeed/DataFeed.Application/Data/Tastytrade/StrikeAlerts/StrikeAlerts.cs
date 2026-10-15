using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using DataFeed.Application.App.Shared;
using DataFeed.Application.Data.Tastytrade.AccountOverview;
using DataFeed.Application.Data.Tastytrade.AccountSpreads;
using MediatR;

namespace DataFeed.Application.Data.Tastytrade.StrikeAlerts
{
    /// <summary>
    /// Aviso cerca del strike vendido (WS-0036, pedido del owner 15/10): cuando el precio del subyacente se acerca a un
    /// strike vendido a menos de la distancia que eligió el usuario, para decidir a tiempo si rolear. Vigila los dos
    /// lados de un iron condor. La distancia y el horario son preferencia del usuario (`preference/aviso-strike`).
    /// </summary>
    public class StrikeAlertsRequest : IRequest<StrikeAlertsResponse>
    {
        public string? AccountNumber { get; set; }
        /// <summary>Contenido de la preferencia del usuario; lo pone el controller. Null = sin configurar (apagado).</summary>
        public string? SettingsJson { get; set; }
    }

    public class StrikeAlertsResponse
    {
        public DateTime AsOf { get; set; }
        public StrikeAlertSettings Settings { get; set; } = new();
        /// <summary>False fuera de la rueda cuando el usuario lo pidió sólo en horario de mercado: no se evaluó.</summary>
        public bool Evaluated { get; set; }
        public List<StrikeAlertDto> Alerts { get; set; } = new();
    }

    public class StrikeAlertSettings
    {
        public bool Enabled { get; set; }
        /// <summary>"points" o "pct" (del precio del subyacente).</summary>
        public string Unit { get; set; } = "points";
        public double Distance { get; set; } = 15;
        public bool MarketHoursOnly { get; set; } = true;
        /// <summary>Distancia propia de una posición (por id de posición), en la misma unidad.</summary>
        public Dictionary<string, double> ByPosition { get; set; } = new();

        private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

        public static StrikeAlertSettings Parse(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new StrikeAlertSettings();
            try
            {
                var s = JsonSerializer.Deserialize<StrikeAlertSettings>(json, Json) ?? new StrikeAlertSettings();
                if (s.Unit != "pct") s.Unit = "points";
                s.ByPosition ??= new();
                return s;
            }
            catch (JsonException) { return new StrikeAlertSettings(); }
        }
    }

    public class StrikeAlertDto
    {
        /// <summary>Posición, lado y día: el mismo aviso suena una vez por día.</summary>
        public string Id { get; set; } = "";
        public string PositionId { get; set; } = "";
        /// <summary>"put" o "call".</summary>
        public string Side { get; set; } = "";
        public double Strike { get; set; }
        public double Spot { get; set; }
        /// <summary>Puntos que le faltan al precio para llegar al strike (negativo: ya lo pasó).</summary>
        public double DistancePoints { get; set; }
        public double DistancePct { get; set; }
        /// <summary>Umbral aplicado, en puntos.</summary>
        public double ThresholdPoints { get; set; }
        public string Title { get; set; } = "";
    }

    public class StrikeAlertsHandler : IRequestHandler<StrikeAlertsRequest, StrikeAlertsResponse>
    {
        private readonly IMediator _mediator;
        public StrikeAlertsHandler(IMediator mediator) => _mediator = mediator;

        public async Task<StrikeAlertsResponse> Handle(StrikeAlertsRequest request, CancellationToken ct)
        {
            var settings = StrikeAlertSettings.Parse(request.SettingsJson);
            var response = new StrikeAlertsResponse { AsOf = DateTime.UtcNow, Settings = settings };
            if (!settings.Enabled || (settings.MarketHoursOnly && !CascadeUtils.IsRegularSessionEt())) return response;

            var account = await _mediator.Send(new AccountSpreadsRequest { AccountNumber = request.AccountNumber }, ct);
            response.Evaluated = true;
            response.Alerts = StrikeProximity.Evaluate(account.Spreads, account.UnderlyingPrices, settings,
                DateOnly.FromDateTime(CascadeUtils.TodayEt())).ToList();
            return response;
        }
    }

    /// <summary>Puro: qué strikes vendidos tienen el precio cerca. Sin red, para poder probarlo.</summary>
    public static class StrikeProximity
    {
        private static readonly CultureInfo Es = new("es-AR");

        public static IEnumerable<StrikeAlertDto> Evaluate(IEnumerable<AccountSpreadDto> spreads,
            IReadOnlyDictionary<string, double> prices, StrikeAlertSettings settings, DateOnly today)
        {
            foreach (var s in spreads)
            {
                if (!prices.TryGetValue(s.UnderlyingSymbol, out var spot) || spot <= 0) continue;
                var distance = settings.ByPosition.TryGetValue(s.Id, out var own) ? own : settings.Distance;
                var threshold = settings.Unit == "pct" ? spot * distance / 100 : distance;
                if (threshold <= 0) continue;

                if (s.ShortPutStrike is double put && spot - put <= threshold)
                    yield return Alert(s, "put", put, spot, spot - put, threshold, today);
                if (s.ShortCallStrike is double call && call - spot <= threshold)
                    yield return Alert(s, "call", call, spot, call - spot, threshold, today);
            }
        }

        private static StrikeAlertDto Alert(AccountSpreadDto s, string side, double strike, double spot, double gap,
            double threshold, DateOnly today)
        {
            var label = AccountOverviewBuilder.Label(s);
            var title = gap > 0
                ? string.Create(Es, $"{label}: el precio ({spot:0.00}) está a {gap:0.0} puntos del {side} vendido {strike:0.##}")
                : string.Create(Es, $"{label}: el precio ({spot:0.00}) pasó el {side} vendido {strike:0.##}");
            return new StrikeAlertDto
            {
                Id = $"{s.Id}|{side}|{today:yyyy-MM-dd}", PositionId = s.Id, Side = side, Strike = strike,
                Spot = Math.Round(spot, 2), DistancePoints = Math.Round(gap, 2), DistancePct = Math.Round(gap / spot * 100, 2),
                ThresholdPoints = Math.Round(threshold, 2), Title = title,
            };
        }
    }
}
