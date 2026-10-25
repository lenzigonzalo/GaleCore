using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using DataFeed.Application.Data.Fed.FomcMeetings;
using DataFeed.Application.Data.Fred.ReleaseDates;
using DataFeed.Application.Data.Tastytrade.AccountBalances;
using DataFeed.Application.Data.Tastytrade.AccountSpreads;
using DataFeed.Application.Data.Tastytrade.MarketMetricsVolatility;
using DataFeed.Application.App.Shared;
using MediatR;

namespace DataFeed.Application.Data.Tastytrade.AccountOverview
{
    public class AccountOverviewHandler : IRequestHandler<AccountOverviewRequest, AccountOverviewResponse>
    {
        // Los datos de la agenda pueden tardar con la caché fría (FRED ~8 s): Inicio no los espera más que esto.
        private static readonly TimeSpan CalendarWait = TimeSpan.FromSeconds(6);
        private static readonly string MacroReleases = DataFeed.Application.App.Runtime.EventCatalog.FredReleaseIdsCsv;

        private readonly IMediator _mediator;

        public AccountOverviewHandler(IMediator mediator) => _mediator = mediator;

        public async Task<AccountOverviewResponse> Handle(AccountOverviewRequest request, CancellationToken ct)
        {
            var today = DateOnly.FromDateTime(CascadeUtils.TodayEt());
            var missing = new List<string>();

            // Cuenta (saldos y posiciones) sale con la credencial del usuario: sus 409 pasan sin envolver.
            var balancesTask = _mediator.Send(new AccountBalancesRequest { AccountNumber = request.AccountNumber, WithHistory = true }, ct);
            var accountTask = _mediator.Send(new AccountSpreadsRequest { AccountNumber = request.AccountNumber }, ct);
            var eventsTask = CalendarAsync(today, missing, ct);
            var balances = await balancesTask;
            var account = await accountTask;

            if (account.Unpaired.Count > 0)
                missing.Add("Patas sin emparejar (no suman a riesgo ni exposición): " + string.Join("; ", account.Unpaired) + ".");

            var symbols = account.Spreads.Select(s => s.UnderlyingSymbol).Concat(account.Equities.Select(e => e.Symbol))
                .Append("SPY").Distinct().ToList();
            var betas = await BetasAsync(symbols, missing, ct);
            var events = await eventsTask;

            var rules = string.IsNullOrWhiteSpace(request.RulesJson) ? null : JsonNode.Parse(request.RulesJson)?.AsObject();
            var (perTrade, openPct, source) = (request.MaxRiskPerTradePct, request.MaxOpenRiskPct, (string?)null);
            if (perTrade == null && openPct == null && request.ProfileJson != null)
            {
                var p = ProfileRiskLimits.Parse(request.ProfileJson);
                (perTrade, openPct) = (p.PerTrade, p.Open);
                if (perTrade != null || openPct != null) source = $"perfil v{p.Version} (espacio)";
                else missing.Add("Topes del perfil: no se leen de su texto; se juzga con las reglas del Monitor.");
            }
            var response = AccountOverviewBuilder.Build(
                (double)balances.NetLiquidatingValue, (double)balances.CashBalance, (double)balances.DerivativeBuyingPower,
                account, betas, rules, today, events, missing, perTrade, openPct, source);
            response.MarginUsed = (double)balances.MaintenanceRequirement;
            response.MarginUsedPct = balances.NetLiquidatingValue > 0
                ? Math.Round((double)(balances.MaintenanceRequirement / balances.NetLiquidatingValue) * 100, 1) : null;
            if (balances.NetLiqHistory == null) missing.Add("Historia del valor de la cuenta (Tastytrade): sin dato; semana, mes y año sin calcular.");
            response.History = balances.NetLiqHistory?.Select(h => new NetLiqPointDto(h.Time, (double)h.Close)).ToList() ?? new();
            response.Intraday = balances.NetLiqIntraday?.Select(h => new NetLiqPointDto(h.Time, (double)h.Close)).ToList() ?? new();
            response.Periods = AccountOverviewBuilder.Periods((double)balances.NetLiquidatingValue, response.DayPnl, response.DayPnlPct,
                balances.NetLiqHistory?.Select(h => (DateOnly.FromDateTime(h.Time), (double)h.Close)).ToList(), today);
            return response;
        }

        private async Task<Dictionary<string, double>> BetasAsync(List<string> symbols, List<string> missing, CancellationToken ct)
        {
            try
            {
                var metrics = await _mediator.Send(new MarketMetricsVolatilityRequest { Symbols = string.Join(",", symbols) }, ct);
                return (metrics.Items ?? new()).Where(i => i.Beta != null).ToDictionary(i => i.Symbol, i => (double)i.Beta!.Value);
            }
            catch (Exception)
            {
                missing.Add("Beta de los subyacentes (Tastytrade): sin dato, la exposición en SPY no se suma.");
                return new Dictionary<string, double>();
            }
        }

        private async Task<IReadOnlyList<CalendarEvent>> CalendarAsync(DateOnly today, List<string> missing, CancellationToken ct)
        {
            var events = new List<CalendarEvent>();
            var from = today.ToDateTime(TimeOnly.MinValue);
            var releases = _mediator.Send(new FredReleaseDatesRequest { From = from, To = from.AddDays(6), ReleaseIds = MacroReleases }, ct);
            var fomc = _mediator.Send(new FomcMeetingsRequest { Years = today.Year.ToString() }, ct);
            var all = Task.WhenAll(releases, fomc);
            if (await Task.WhenAny(all, Task.Delay(CalendarWait, ct)) != all || all.IsFaulted)
            {
                missing.Add("Agenda de datos de EE. UU. y de la Fed: no respondió a tiempo.");
                return events;
            }
            events.AddRange(releases.Result.Data.Select(r => new CalendarEvent(DateOnly.Parse(r.Date[..10]), r.ReleaseName)));
            events.AddRange(fomc.Result.Data.Where(m => m.End >= today).Select(m => new CalendarEvent(m.End, "FOMC")));
            return events;
        }
    }
}
