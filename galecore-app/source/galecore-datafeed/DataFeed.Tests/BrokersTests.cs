using System.Net;
using System.Text.Json;
using DataFeed.Application.App.Brokers;
using DataFeed.Application.Data.Argentina;
using DataFeed.Application.Data.Tastytrade.AccountBalances;
using DataFeed.Application.Data.Tastytrade.AccountPositions;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Ibkr;
using DataFeed.Infrastructure.Providers.Iol;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace DataFeed.Tests;

/// <summary>WS-0108 — brokers del usuario: lista por estado, credencial de IOL, interruptor, cliente IOL (token/refresh) y mapeo del portafolio.</summary>
public class BrokersTests
{
    private static readonly Guid User = Guid.NewGuid();
    private const string Password = "s3cr3t-pass-IOL";

    // ── fakes ──────────────────────────────────────────────────────────────────────────────────────────────────

    private sealed class FakeProtector : ITokenProtector
    {
        public string Protect(string plaintext) => "enc:" + plaintext;
        public string Unprotect(string ciphertext) => ciphertext.StartsWith("enc:") ? ciphertext[4..] : throw new InvalidOperationException("no descifra");
    }

    private sealed class FakeStore : IBrokerStore
    {
        public Dictionary<string, UserBrokerRow> Rows { get; } = new();
        public bool TastytradeLinked { get; set; }

        private UserBrokerRow Row(string b) => Rows.TryGetValue(b, out var r) ? r : new UserBrokerRow(b, true, null, null, null, null, null);

        public Task<IReadOnlyList<UserBrokerRow>> LoadAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<UserBrokerRow>>(Rows.Values.ToList());

        public Task<bool> HasTastytradeAccountAsync(Guid userId, CancellationToken ct) => Task.FromResult(TastytradeLinked);

        public Task SaveSecretAsync(Guid userId, string broker, string cipher, string? hint, DateTime now, CancellationToken ct)
        {
            Rows[broker] = Row(broker) with { SecretCipher = cipher, SecretHint = hint, LastCheckAt = null, LastCheckOk = null, LastCheckMessage = null };
            return Task.CompletedTask;
        }

        public Task ClearSecretAsync(Guid userId, string broker, DateTime now, CancellationToken ct)
        {
            Rows[broker] = Row(broker) with { SecretCipher = null, SecretHint = null, LastCheckAt = null, LastCheckOk = null, LastCheckMessage = null };
            return Task.CompletedTask;
        }

        public Task SetIncludeAsync(Guid userId, string broker, bool include, DateTime now, CancellationToken ct)
        {
            Rows[broker] = Row(broker) with { Include = include };
            return Task.CompletedTask;
        }

        public Task SaveCheckAsync(Guid userId, string broker, DateTime at, bool ok, string message, CancellationToken ct)
        {
            Rows[broker] = Row(broker) with { LastCheckAt = at, LastCheckOk = ok, LastCheckMessage = message };
            return Task.CompletedTask;
        }
    }

    private sealed class FakeIol : IIolClient
    {
        public bool RejectLogin { get; set; }
        public Exception? ReadFails { get; set; }
        public int Logins { get; private set; }
        public int Forgets { get; private set; }
        public IolBalances Ar { get; set; } = new();
        public IolBalances Us { get; set; } = new();
        public IolPositions ArPositions { get; set; } = new();
        public IolPositions UsPositions { get; set; } = new();

        public Task LoginAsync(Guid userId, IolCredentials credentials, CancellationToken ct)
        {
            Logins++;
            return RejectLogin ? Task.FromException(new IolCredentialInvalidException()) : Task.CompletedTask;
        }

        public Task<IolBalances> GetBalancesAsync(Guid userId, IolCredentials credentials, string country, CancellationToken ct) =>
            ReadFails != null ? Task.FromException<IolBalances>(ReadFails) : Task.FromResult(country == "AR" ? Ar : Us);

        public Task<IolPositions> GetPositionsAsync(Guid userId, IolCredentials credentials, string country, CancellationToken ct) =>
            ReadFails != null ? Task.FromException<IolPositions>(ReadFails) : Task.FromResult(country == "AR" ? ArPositions : UsPositions);

        public void Forget(Guid userId) => Forgets++;
    }

    private sealed class FakeIbkr : IIbkrFlexClient
    {
        public Exception? Fails { get; set; }
        public int Reports { get; private set; }
        public int Forgets { get; private set; }
        public IbkrFlexReport Report { get; set; } = IbkrFlexParser.ParseReport(IbkrFlexParser.Load(IbkrFlexFixture.Report));

        public Task<IbkrFlexReport> GetReportAsync(Guid userId, IbkrCredentials credentials, bool useCache, CancellationToken ct)
        {
            Reports++;
            return Fails != null ? Task.FromException<IbkrFlexReport>(Fails) : Task.FromResult(Report);
        }

        public void Forget(Guid userId) => Forgets++;
    }

    private static (BrokersService Service, FakeStore Store, FakeIol Iol) NewRig(bool withStore = true, Func<CancellationToken, Task>? probe = null)
    {
        var store = new FakeStore();
        var iol = new FakeIol();
        var service = new BrokersService(withStore ? store : null, new FakeProtector(), iol, new FakeIbkr(), probe, NullLogger<BrokersService>.Instance);
        return (service, store, iol);
    }

    // ── lista ──────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Lista_los_tres_brokers_con_su_estado()
    {
        var (service, store, _) = NewRig();
        var vacio = await service.ListAsync(User, default);
        Assert.Equal(new[] { "tastytrade", "ibkr", "iol" }, vacio.Select(b => b.Id).OrderBy(i => i == "tastytrade" ? 0 : i == "ibkr" ? 1 : 2));
        Assert.Equal("missing", vacio.Single(b => b.Id == "tastytrade").Status);
        Assert.Equal("missing", vacio.Single(b => b.Id == "iol").Status);
        Assert.Equal("missing", vacio.Single(b => b.Id == "ibkr").Status);
        Assert.All(vacio, b => Assert.True(b.Include));

        store.TastytradeLinked = true;
        await service.SetIolCredentialsAsync(User, "usuarioiol1", Password, default);
        var lista = await service.ListAsync(User, default);
        Assert.Equal("connected", lista.Single(b => b.Id == "tastytrade").Status);
        var iol = lista.Single(b => b.Id == "iol");
        Assert.Equal("connected", iol.Status);
        Assert.Equal("••iol1", iol.Hint);
        Assert.True(iol.LastCheck!.Ok);
        Assert.Equal("IOL", iol.Name);
    }

    [Fact]
    public async Task Una_prueba_fallida_deja_el_broker_en_invalid()
    {
        var (service, store, iol) = NewRig();
        store.TastytradeLinked = true;
        await service.SetIolCredentialsAsync(User, "usuarioiol1", Password, default);
        iol.ReadFails = new IolCredentialInvalidException();

        var result = await service.TestAsync(User, "iol", default);

        Assert.False(result!.Ok);
        Assert.Equal("invalid", result.Status);
        Assert.Equal("invalid", (await service.ListAsync(User, default)).Single(b => b.Id == "iol").Status);
    }

    [Fact]
    public async Task Sin_base_la_lista_sale_missing_y_escribir_da_storage_no_disponible()
    {
        var (service, _, _) = NewRig(withStore: false);
        var lista = await service.ListAsync(User, default);
        Assert.Equal("missing", lista.Single(b => b.Id == "iol").Status);
        Assert.Equal(BrokerWriteOutcome.StorageUnavailable, (await service.SetIolCredentialsAsync(User, "u", "p", default)).Outcome);
        Assert.Equal(BrokerWriteOutcome.StorageUnavailable, await service.SetIncludeAsync(User, "iol", false, default));
    }

    // ── credencial de IOL ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Login_ok_guarda_cifrado_y_la_lista_no_devuelve_la_contrasena()
    {
        var (service, store, iol) = NewRig();

        var (outcome, _) = await service.SetIolCredentialsAsync(User, "usuarioiol1", Password, default);

        Assert.Equal(BrokerWriteOutcome.Ok, outcome);
        var cipher = store.Rows["iol"].SecretCipher!;
        Assert.StartsWith("enc:", cipher);
        using var doc = JsonDocument.Parse(cipher[4..]);
        Assert.Equal("usuarioiol1", doc.RootElement.GetProperty("username").GetString());
        Assert.Equal(Password, doc.RootElement.GetProperty("password").GetString());
        Assert.Equal(1, iol.Logins);

        var json = Newtonsoft.Json.JsonConvert.SerializeObject(await service.ListAsync(User, default));
        Assert.DoesNotContain(Password, json);
        Assert.DoesNotContain("usuarioiol1", json); // sólo el hint
    }

    [Fact]
    public async Task Login_rechazado_no_guarda_y_devuelve_el_motivo()
    {
        var (service, store, iol) = NewRig();
        iol.RejectLogin = true;

        var (outcome, message) = await service.SetIolCredentialsAsync(User, "usuarioiol1", Password, default);

        Assert.Equal(BrokerWriteOutcome.Rejected, outcome);
        Assert.Contains("IOL rechazó", message);
        Assert.DoesNotContain(Password, message);
        Assert.Empty(store.Rows);
    }

    [Fact]
    public async Task Usuario_corto_no_tiene_hint_y_campos_vacios_son_invalidos()
    {
        var (service, _, _) = NewRig();
        await service.SetIolCredentialsAsync(User, "corto", Password, default);
        Assert.Null((await service.ListAsync(User, default)).Single(b => b.Id == "iol").Hint);

        Assert.Equal(BrokerWriteOutcome.Invalid, (await service.SetIolCredentialsAsync(User, " ", Password, default)).Outcome);
        Assert.Equal(BrokerWriteOutcome.Invalid, (await service.SetIolCredentialsAsync(User, "usuarioiol1", "", default)).Outcome);
    }

    [Fact]
    public async Task Borrar_la_credencial_vuelve_a_missing_y_conserva_el_interruptor()
    {
        var (service, store, iol) = NewRig();
        await service.SetIolCredentialsAsync(User, "usuarioiol1", Password, default);
        await service.SetIncludeAsync(User, "iol", false, default);

        await service.DeleteIolCredentialsAsync(User, default);

        var view = (await service.ListAsync(User, default)).Single(b => b.Id == "iol");
        Assert.Equal("missing", view.Status);
        Assert.False(view.Include);
        Assert.Null(store.Rows["iol"].SecretCipher);
        Assert.True(iol.Forgets >= 1);
    }

    // ── include ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Include_se_guarda_por_broker_sin_secreto_y_rechaza_ids_desconocidos()
    {
        var (service, store, _) = NewRig();

        Assert.Equal(BrokerWriteOutcome.Ok, await service.SetIncludeAsync(User, "tastytrade", false, default));
        Assert.Equal(BrokerWriteOutcome.UnknownBroker, await service.SetIncludeAsync(User, "fred", false, default));

        Assert.Null(store.Rows["tastytrade"].SecretCipher);
        var lista = await service.ListAsync(User, default);
        Assert.False(lista.Single(b => b.Id == "tastytrade").Include);
        Assert.True(lista.Single(b => b.Id == "iol").Include);
    }

    [Fact]
    public async Task Test_de_tastytrade_mapea_las_excepciones_de_cuenta()
    {
        var (sinCuenta, _, _) = NewRig(probe: _ => throw new BrokerAccountNotLinkedException());
        Assert.Equal("missing", (await sinCuenta.TestAsync(User, "tastytrade", default))!.Status);

        var (rechazada, _, _) = NewRig(probe: _ => throw new BrokerCredentialInvalidException("invalid_grant"));
        var r = (await rechazada.TestAsync(User, "tastytrade", default))!;
        Assert.False(r.Ok);
        Assert.Equal("invalid", r.Status);
        Assert.DoesNotContain("invalid_grant", r.Message);

        var (ok, _, _) = NewRig(probe: _ => Task.CompletedTask);
        Assert.True((await ok.TestAsync(User, "tastytrade", default))!.Ok);
        Assert.Null(await ok.TestAsync(User, "fred", default));
    }

    // ── cartera de IOL ─────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Portafolio_sin_credencial_es_cuenta_no_vinculada()
    {
        var (service, _, _) = NewRig();
        await Assert.ThrowsAsync<BrokerAccountNotLinkedException>(() => service.GetIolPortfolioAsync(User, default));
    }

    [Fact]
    public async Task Portafolio_una_caida_de_IOL_no_se_tapa()
    {
        var (service, _, iol) = NewRig();
        await service.SetIolCredentialsAsync(User, "usuarioiol1", Password, default);
        iol.ReadFails = new UpstreamSourceException("IOL", "no se pudo conectar.");
        await Assert.ThrowsAsync<UpstreamSourceException>(() => service.GetIolPortfolioAsync(User, default));
    }

    [Fact]
    public async Task Portafolio_mapea_saldos_y_posiciones_a_la_forma_de_GaleCore()
    {
        var (service, _, iol) = NewRig();
        await service.SetIolCredentialsAsync(User, "usuarioiol1", Password, default);
        iol.Ar = new IolBalances
        {
            Ars = new IolCurrencyBalance { Currency = "ARS", Totals = new IolTerms { T0 = 1000m, T1 = 5m }, Available = new IolTerms { T0 = 400m } },
            Usd = new IolCurrencyBalance { Currency = "USD", Totals = new IolTerms { T0 = 50m }, Available = new IolTerms { T0 = 20m } },
        };
        iol.Us = new IolBalances { Usd = new IolCurrencyBalance { Currency = "dolar_Estadounidense", Totals = new IolTerms { T0 = 300m }, Available = new IolTerms { T0 = 100m } } };
        iol.ArPositions = new IolPositions
        {
            Account = "AR", Currency = "ARS",
            Positions = new List<IolPosition>
            {
                new()
                {
                    Instrument = new IolInstrument { Symbol = "AL30", Name = "Bonar 2030", Type = "BONO", Exchange = "BCBA", Currency = "ARS", LotSize = 100 },
                    Quantity = 100m,
                    CostBasis = new IolCostBasis { AverageEntryPrice = 50m, TotalCost = 50m },
                    MarketValue = new IolMarketValue { CurrentPrice = 60m },
                    ProfitLoss = new IolProfitLoss { UnrealizedPl = 10m, UnrealizedPlPercent = 20m },
                },
            },
        };
        iol.UsPositions = new IolPositions
        {
            Account = "US", Currency = "USD",
            Positions = new List<IolPosition>
            {
                new() { Instrument = new IolInstrument { Symbol = "SPY", Name = "SPDR", AssetClass = "ETF", Exchange = "NYSE" }, Quantity = 2m, MarketValue = new IolMarketValue { CurrentPrice = 500m } },
            },
        };

        var p = await service.GetIolPortfolioAsync(User, default);

        Assert.Equal("IOL", p.Source);
        Assert.Equal(DateTimeKind.Utc, p.AsOf.Kind);
        Assert.Equal(3, p.Balances.Count);
        Assert.Contains(p.Balances, b => b is { Account: "AR", Currency: "ARS", Available: 400m, Total: 1000m });
        Assert.Contains(p.Balances, b => b is { Account: "AR", Currency: "USD", Available: 20m, Total: 50m });
        Assert.Contains(p.Balances, b => b is { Account: "US", Currency: "USD", Available: 100m, Total: 300m });

        var al30 = p.Positions.Single(x => x.Symbol == "AL30");
        Assert.Equal("Bonar 2030", al30.Description);
        Assert.Equal("BONO", al30.Type);
        Assert.Equal("BCBA", al30.Market);
        Assert.Equal(100m, al30.Quantity);
        Assert.Equal(50m, al30.AverageCost);
        Assert.Equal(60m, al30.LastPrice);
        Assert.Equal(60m, al30.MarketValue); // costo + ganancia, no cantidad x precio (el bono cotiza cada 100)
        Assert.Equal("ARS", al30.Currency);
        Assert.Equal(10m, al30.Pnl);
        Assert.Equal(20m, al30.PnlPct);

        var spy = p.Positions.Single(x => x.Symbol == "SPY");
        Assert.Equal("ETF", spy.Type); // sin type, cae a asset_class
        Assert.Equal(1000m, spy.MarketValue); // sin costo ni ganancia: cantidad x precio
        Assert.Equal("USD", spy.Currency);
        Assert.Null(spy.Pnl);
    }

    private static async Task<IolPositionView> IolPosicionAsync(string symbol, string? type, decimal qty, decimal avg, decimal last, decimal pnl)
    {
        var (service, _, iol) = NewRig();
        await service.SetIolCredentialsAsync(User, "usuarioiol1", Password, default);
        iol.ArPositions = new IolPositions
        {
            Account = "AR", Currency = "ARS",
            Positions = new List<IolPosition>
            {
                new()
                {
                    Instrument = new IolInstrument { Symbol = symbol, Type = type },
                    Quantity = qty,
                    CostBasis = new IolCostBasis { AverageEntryPrice = avg, TotalCost = qty * avg },
                    MarketValue = new IolMarketValue { CurrentPrice = last },
                    ProfitLoss = new IolProfitLoss { UnrealizedPl = pnl },
                },
            },
        };
        var p = await service.GetIolPortfolioAsync(User, default);
        return p.Positions.Single(x => x.Symbol == symbol);
    }

    [Fact]
    public async Task Portafolio_bono_cotizado_por_100_valua_cantidad_x_precio_sobre_100()
    {
        var v = await IolPosicionAsync("TZX27", "TITULOS PUBLICOS", 1348361m, 373.26890232m, 425.15m, 699544.4874890248m);
        Assert.InRange(v.MarketValue!.Value, 5732556.79m - 0.01m, 5732556.79m + 0.01m);
    }

    [Fact]
    public async Task Portafolio_accion_valua_cantidad_x_precio()
    {
        var v = await IolPosicionAsync("YPFD", "ACCIONES", 80m, 5475m, 5835m, 28800m);
        Assert.Equal(466800m, v.MarketValue);
    }

    [Fact]
    public async Task Portafolio_bono_sin_ganancia_usa_el_tipo_para_la_escala()
    {
        var v = await IolPosicionAsync("AL30", "TIT. PUBLICOS", 1000m, 50m, 60m, 0m);
        Assert.Equal(600m, v.MarketValue);
    }

    [Fact]
    public void Las_monedas_largas_se_normalizan()
    {
        Assert.Equal("ARS", IolPortfolioMapper.NormalizeCurrency("peso_Argentino"));
        Assert.Equal("USD", IolPortfolioMapper.NormalizeCurrency("dolar_Estadounidense"));
        Assert.Equal("USD", IolPortfolioMapper.NormalizeCurrency("usd"));
        Assert.Null(IolPortfolioMapper.NormalizeCurrency(null));
    }

    // ── cliente IOL: token en memoria, refresh y errores ───────────────────────────────────────────────────────

    private sealed class ScriptedHandler : HttpMessageHandler
    {
        public List<(HttpMethod Method, string Url, string Body, string? Auth)> Calls { get; } = new();
        public List<string> UserAgents { get; } = new();
        public Func<(HttpMethod Method, string Url, string Body), (HttpStatusCode, string)> Respond { get; set; } = _ => (HttpStatusCode.OK, "{}");
        public Exception? Throw { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content == null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            Calls.Add((request.Method, request.RequestUri!.ToString(), body, request.Headers.Authorization?.ToString()));
            UserAgents.Add(request.Headers.UserAgent.ToString());
            if (Throw != null) throw Throw;
            var (status, content) = Respond((request.Method, request.RequestUri.ToString(), body));
            return new HttpResponseMessage(status) { Content = new StringContent(content) };
        }
    }

    private sealed class Factory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _h;
        public Factory(HttpMessageHandler h) => _h = h;
        public HttpClient CreateClient(string name) => new(_h, disposeHandler: false);
    }

    private static string TokenBody(string access, string refresh, int expiresIn = 900) =>
        $"{{\"meta\":{{\"trace_id\":\"t\"}},\"data\":{{\"access_token\":\"{access}\",\"refresh_token\":\"{refresh}\",\"expires_in\":{expiresIn},\"token_type\":\"bearer\"}},\"error\":null}}";

    private const string EmptyBalances = "{\"meta\":{},\"data\":{\"ars\":{\"currency\":\"ARS\",\"totals\":{\"t0\":1}}},\"error\":null}";

    private static (IolClient Client, ScriptedHandler Handler, Func<DateTime> Clock, Action<TimeSpan> Advance) NewClient()
    {
        var handler = new ScriptedHandler();
        var now = new DateTime(2026, 11, 23, 12, 0, 0, DateTimeKind.Utc);
        var client = new IolClient(new Factory(handler), new ConfigurationBuilder().Build(), null, () => now);
        return (client, handler, () => now, d => now += d);
    }

    private static readonly IolCredentials Creds = new("usuarioiol1", Password);

    [Fact]
    public async Task Cliente_login_manda_json_a_auth_token_y_lee_con_bearer_cacheado()
    {
        var (client, handler, _, _) = NewClient();
        handler.Respond = r => r.Url.EndsWith("/auth/token") ? (HttpStatusCode.OK, TokenBody("AAA", "RRR")) : (HttpStatusCode.OK, EmptyBalances);

        var b1 = await client.GetBalancesAsync(User, Creds, "AR", default);
        await client.GetBalancesAsync(User, Creds, "AR", default);

        Assert.Equal(1m, b1.Ars!.Totals!.T0);
        var logins = handler.Calls.Where(c => c.Url.EndsWith("/auth/token")).ToList();
        Assert.Single(logins); // el segundo pedido usó el token en memoria
        Assert.StartsWith("https://api.iolinversiones.com/auth/token", logins[0].Url);
        using var sent = JsonDocument.Parse(logins[0].Body);
        Assert.Equal("password", sent.RootElement.GetProperty("grant_type").GetString());
        Assert.Equal("usuarioiol1", sent.RootElement.GetProperty("username").GetString());
        var reads = handler.Calls.Where(c => c.Url.Contains("/broker/accounts/AR/balances")).ToList();
        Assert.Equal(2, reads.Count);
        Assert.All(reads, c => Assert.Equal("Bearer AAA", c.Auth));
        Assert.All(handler.UserAgents, ua => Assert.False(string.IsNullOrEmpty(ua))); // sin User-Agent, Cloudflare de IOL da 403
    }

    [Fact]
    public async Task Cliente_reintenta_una_vez_si_el_Cloudflare_de_IOL_bloquea_la_conexion()
    {
        var (client, handler, _, _) = NewClient();
        var blocked = 1;
        handler.Respond = r =>
        {
            if (r.Url.EndsWith("/auth/token") && blocked-- > 0) return (HttpStatusCode.Forbidden, "<!DOCTYPE html><html>Ray ID: <strong class=\"x\">abc123</strong></html>");
            return r.Url.EndsWith("/auth/token") ? (HttpStatusCode.OK, TokenBody("AAA", "RRR")) : (HttpStatusCode.OK, EmptyBalances);
        };

        await client.GetBalancesAsync(User, Creds, "AR", default);

        Assert.Equal(2, handler.Calls.Count(c => c.Url.EndsWith("/auth/token")));
    }

    [Fact]
    public async Task Cliente_no_reintenta_un_403_de_la_propia_IOL()
    {
        var (client, handler, _, _) = NewClient();
        handler.Respond = _ => (HttpStatusCode.Forbidden, "{\"meta\":{\"trace_id\":\"t1\"},\"data\":null,\"error\":{\"message\":\"Forbidden\",\"code\":\"X\"}}");

        await Assert.ThrowsAnyAsync<Exception>(() => client.GetBalancesAsync(User, Creds, "AR", default));

        Assert.Single(handler.Calls);
    }

    [Fact]
    public async Task Cliente_renueva_con_refresh_antes_de_vencer_y_no_reenvia_la_contrasena()
    {
        var (client, handler, _, advance) = NewClient();
        handler.Respond = r =>
        {
            if (!r.Url.EndsWith("/auth/token")) return (HttpStatusCode.OK, EmptyBalances);
            return r.Body.Contains("refresh_token\":\"RRR") ? (HttpStatusCode.OK, TokenBody("BBB", "RR2")) : (HttpStatusCode.OK, TokenBody("AAA", "RRR", 900));
        };
        await client.GetBalancesAsync(User, Creds, "AR", default);

        advance(TimeSpan.FromSeconds(880)); // dentro del margen de 60 s antes de vencer
        await client.GetBalancesAsync(User, Creds, "AR", default);

        var tokenCalls = handler.Calls.Where(c => c.Url.EndsWith("/auth/token")).ToList();
        Assert.Equal(2, tokenCalls.Count);
        Assert.Contains("\"grant_type\":\"refresh_token\"", tokenCalls[1].Body);
        Assert.DoesNotContain(Password, tokenCalls[1].Body);
        Assert.Equal("Bearer BBB", handler.Calls.Last().Auth);
    }

    [Fact]
    public async Task Cliente_si_el_refresh_falla_vuelve_a_pedir_con_usuario_y_contrasena()
    {
        var (client, handler, _, advance) = NewClient();
        var logins = 0;
        handler.Respond = r =>
        {
            if (!r.Url.EndsWith("/auth/token")) return (HttpStatusCode.OK, EmptyBalances);
            if (r.Body.Contains("refresh_token\":")) return (HttpStatusCode.Unauthorized, "{\"data\":null,\"error\":{\"message\":\"vencido\"}}");
            logins++;
            return (HttpStatusCode.OK, TokenBody("T" + logins, "R" + logins));
        };
        await client.GetBalancesAsync(User, Creds, "AR", default);

        advance(TimeSpan.FromMinutes(20));
        await client.GetBalancesAsync(User, Creds, "AR", default);

        Assert.Equal(2, logins);
        Assert.Equal("Bearer T2", handler.Calls.Last().Auth);
    }

    [Fact]
    public async Task Cliente_un_401_de_lectura_descarta_el_token_y_reintenta_una_vez()
    {
        var (client, handler, _, _) = NewClient();
        var logins = 0;
        handler.Respond = r =>
        {
            if (r.Url.EndsWith("/auth/token")) { logins++; return (HttpStatusCode.OK, TokenBody("T" + logins, "R")); }
            return r.Url.Contains("/balances") && handler.Calls.Last().Auth == "Bearer T1" ? (HttpStatusCode.Unauthorized, "{}") : (HttpStatusCode.OK, EmptyBalances);
        };

        var result = await client.GetBalancesAsync(User, Creds, "AR", default);

        Assert.NotNull(result.Ars);
        Assert.Equal(2, logins);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Unauthorized)]
    public async Task Cliente_login_400_o_401_es_credencial_invalida(HttpStatusCode status)
    {
        var (client, handler, _, _) = NewClient();
        handler.Respond = _ => (status, "{\"data\":null,\"error\":{\"message\":\"x\"}}");
        await Assert.ThrowsAsync<IolCredentialInvalidException>(() => client.LoginAsync(User, Creds, default));
    }

    [Fact]
    public async Task Cliente_5xx_y_caida_de_red_son_UpstreamSourceException_sin_credenciales()
    {
        var (client, handler, _, _) = NewClient();
        handler.Respond = _ => (HttpStatusCode.BadGateway, "{\"meta\":{\"trace_id\":\"abc-123\"},\"data\":null,\"error\":{\"message\":\"caído\",\"code\":\"X\"}}");
        var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() => client.LoginAsync(User, Creds, default));
        Assert.Contains("502", ex.Message);
        Assert.Contains("abc-123", ex.Message);
        Assert.DoesNotContain(Password, ex.Message);

        handler.Throw = new HttpRequestException("https://api.iolinversiones.com/auth/token?" + Password);
        var ex2 = await Assert.ThrowsAsync<UpstreamSourceException>(() => client.LoginAsync(User, Creds, default));
        Assert.DoesNotContain(Password, ex2.Message);
    }

    [Fact]
    public async Task Cliente_deserializa_tolerante_campos_faltantes()
    {
        var (client, handler, _, _) = NewClient();
        handler.Respond = r => r.Url.EndsWith("/auth/token")
            ? (HttpStatusCode.OK, TokenBody("AAA", "RRR"))
            : (HttpStatusCode.OK, "{\"data\":{\"account\":\"AR\",\"positions\":[{\"instrument\":{\"symbol\":\"GGAL\"},\"quantity\":3,\"campo_nuevo\":1}]},\"error\":null}");

        var data = await client.GetPositionsAsync(User, Creds, "AR", default);

        var p = Assert.Single(data.Positions!);
        Assert.Equal("GGAL", p.Instrument!.Symbol);
        Assert.Null(p.CostBasis);
        Assert.Null(p.ProfitLoss);
    }

    [Fact]
    public async Task Cliente_usa_Iol_BaseUrl_de_la_configuracion()
    {
        var handler = new ScriptedHandler { Respond = _ => (HttpStatusCode.OK, TokenBody("A", "R")) };
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Iol:BaseUrl"] = "https://iol.test/" }).Build();
        await new IolClient(new Factory(handler), config).LoginAsync(User, Creds, default);
        Assert.Equal("https://iol.test/auth/token", handler.Calls.Single().Url);
    }

    // ── IBKR por Flex Web Service ─────────────────────────────────────────────────────────────────────────────

    private const string FlexToken = "tok-FLEX-secreto-123456";
    private const string FlexQuery = "987654";

    private static (BrokersService Service, FakeStore Store, FakeIbkr Ibkr) NewIbkrRig(bool withStore = true)
    {
        var store = new FakeStore();
        var ibkr = new FakeIbkr();
        var service = new BrokersService(withStore ? store : null, new FakeProtector(), new FakeIol(), ibkr, null, NullLogger<BrokersService>.Instance);
        return (service, store, ibkr);
    }

    private static IbkrFlexReport Parse(string xml) => IbkrFlexParser.ParseReport(IbkrFlexParser.Load(xml));

    [Fact]
    public void Parser_lee_posiciones_saldos_y_nav_y_descarta_los_lotes()
    {
        var st = Assert.Single(Parse(IbkrFlexFixture.Report).Statements);
        Assert.Equal("U0000000", st.Account);
        Assert.Equal("USD", st.BaseCurrency);
        Assert.Equal("2026-11-20", st.ToDate);
        Assert.Equal(new DateTime(2026, 11, 21, 21, 30, 45, DateTimeKind.Utc), st.WhenGenerated);
        Assert.Equal(30125.45m, st.Nav); // la fila de reportDate más reciente

        Assert.Equal(2, st.Positions.Count); // la fila LOT de AAPL no cuenta
        var stock = st.Positions.Single(p => p.Symbol == "AAPL");
        Assert.Equal(100m, stock.Quantity);
        Assert.Equal(15000m, stock.CostBasisMoney);
        var opt = st.Positions.Single(p => p.AssetCategory == "OPT");
        Assert.Equal(-2m, opt.Quantity);
        Assert.Equal(100m, opt.Multiplier);
        Assert.Equal("P", opt.PutCall);
        Assert.Equal(500m, opt.Strike);
        Assert.Equal("2026-12-18", opt.Expiry);
        Assert.Equal("SPY", opt.UnderlyingSymbol);
        Assert.Null(opt.ListingExchange); // atributo vacío = faltante

        Assert.Equal(new[] { "USD", "EUR" }, st.Cash.Select(c => c.Currency)); // BASE_SUMMARY no es un saldo
        Assert.Equal(-300.10m, st.Cash.Single(c => c.Currency == "EUR").EndingCash);
    }

    [Fact]
    public void Parser_cuenta_de_una_moneda_toma_el_cash_de_BASE_SUMMARY_o_del_resumen_del_nav()
    {
        var soloBase = """
            <FlexQueryResponse><FlexStatements count="2">
              <FlexStatement accountId="U1" whenGenerated="20260701;120000"><AccountInformation currency="USD" />
                <CashReport><CashReportCurrency currency="BASE_SUMMARY" endingCash="28.69" /></CashReport></FlexStatement>
              <FlexStatement accountId="U2"><AccountInformation currency="USD" />
                <EquitySummaryInBase><EquitySummaryByReportDateInBase reportDate="20261120" cash="12.5" total="100" /></EquitySummaryInBase></FlexStatement>
            </FlexStatements></FlexQueryResponse>
            """;
        var r = Parse(soloBase);
        Assert.Equal(("USD", 28.69m), (r.Statements[0].Cash.Single().Currency, r.Statements[0].Cash.Single().EndingCash!.Value));
        Assert.Equal(("USD", 12.5m), (r.Statements[1].Cash.Single().Currency, r.Statements[1].Cash.Single().EndingCash!.Value));
        Assert.Equal(new DateTime(2026, 7, 1, 16, 0, 0, DateTimeKind.Utc), r.Statements[0].WhenGenerated); // horario de verano de Nueva York
    }

    [Fact]
    public void Parser_recorre_todos_los_statements_y_acepta_posiciones_sin_levelOfDetail()
    {
        var xml = """
            <FlexQueryResponse><FlexStatements count="2">
              <FlexStatement accountId="U1" toDate="20261120"><OpenPositions><OpenPosition symbol="A" position="1" /></OpenPositions></FlexStatement>
              <FlexStatement accountId="U2" toDate="20261120"><OpenPositions><OpenPosition symbol="B" position="2.5" /></OpenPositions></FlexStatement>
            </FlexStatements></FlexQueryResponse>
            """;
        var r = Parse(xml);
        Assert.Equal(new[] { "U1", "U2" }, r.Statements.Select(s => s.Account));
        Assert.Equal(2.5m, r.Statements[1].Positions.Single().Quantity);
        Assert.Null(r.Statements[1].Nav);
    }

    [Fact]
    public void Mapper_arma_la_respuesta_con_pnl_porcentual_sobre_el_costo()
    {
        var r = IbkrPortfolioMapper.Map(Parse(IbkrFlexFixture.Report));
        Assert.Equal("IBKR Flex", r.Source);
        Assert.Equal("2026-11-20", r.ReportDate);
        Assert.Equal(new DateTime(2026, 11, 21, 21, 30, 45, DateTimeKind.Utc), r.AsOf);
        var stock = r.Positions.Single(p => p.Symbol == "AAPL");
        Assert.Equal("U0000000", stock.Account);
        Assert.Equal("STK", stock.Type);
        Assert.Equal(150m, stock.AverageCost);
        Assert.Equal(18025m, stock.MarketValue);
        Assert.Equal(3025m / 15000m * 100m, stock.PnlPct);
        var opt = r.Positions.Single(p => p.Type == "OPT");
        Assert.Equal(25m, opt.PnlPct); // corto: 300 / |-1200|
        Assert.Equal("SPY", opt.Underlying);
        Assert.Equal(2, r.Balances.Count);
        Assert.Equal(12500.55m, r.Balances.Single(b => b.Currency == "USD").Total);
        var nav = Assert.Single(r.Nav);
        Assert.Equal("USD", nav.Currency);
        Assert.Equal(30125.45m, nav.Total);
    }

    [Fact]
    public void Mapper_sin_costo_no_calcula_porcentaje()
    {
        var r = IbkrPortfolioMapper.Map(Parse("<FlexQueryResponse><FlexStatements><FlexStatement accountId=\"U1\"><OpenPositions><OpenPosition symbol=\"A\" fifoPnlUnrealized=\"5\" costBasisMoney=\"0\" /></OpenPositions></FlexStatement></FlexStatements></FlexQueryResponse>"));
        Assert.Null(r.Positions.Single().PnlPct);
    }

    // ── cliente IBKR ──────────────────────────────────────────────────────────────────────────────────────────

    private static (IbkrFlexClient Client, ScriptedHandler Handler, Func<DateTime> Clock, Action<TimeSpan> Advance) NewFlexClient(params string[] getResponses)
    {
        var handler = new ScriptedHandler();
        var queue = new Queue<string>(getResponses);
        handler.Respond = r => r.Url.Contains("SendRequest") ? (HttpStatusCode.OK, IbkrFlexFixture.SendOk) : (HttpStatusCode.OK, queue.Count > 1 ? queue.Dequeue() : queue.Peek());
        var now = new DateTime(2026, 11, 23, 12, 0, 0, DateTimeKind.Utc);
        var waits = new[] { TimeSpan.Zero, TimeSpan.Zero, TimeSpan.Zero, TimeSpan.Zero, TimeSpan.Zero, TimeSpan.Zero };
        return (new IbkrFlexClient(new Factory(handler), null, waits, () => now), handler, () => now, d => now += d);
    }

    private static readonly IbkrCredentials FlexCreds = new(FlexToken, FlexQuery);

    [Fact]
    public async Task Cliente_Ibkr_pide_SendRequest_y_GetStatement_con_User_Agent()
    {
        var (client, handler, _, _) = NewFlexClient(IbkrFlexFixture.Report);
        var report = await client.GetReportAsync(User, FlexCreds, false, default);
        Assert.Equal(2, handler.Calls.Count);
        Assert.StartsWith("https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t=" + FlexToken + "&q=" + FlexQuery + "&v=3", handler.Calls[0].Url);
        Assert.Contains("GetStatement?q=1234567890&t=" + FlexToken + "&v=3", handler.Calls[1].Url);
        Assert.All(handler.UserAgents, ua => Assert.Equal("GaleCore/1.0", ua));
        Assert.Equal(2, report.Statements.Single().Positions.Count);
    }

    [Fact]
    public async Task Cliente_Ibkr_reintenta_mientras_genera_el_reporte_1019()
    {
        var (client, handler, _, _) = NewFlexClient(IbkrFlexFixture.Fail("1019", "Statement generation in progress"), IbkrFlexFixture.Fail("1019", "Statement generation in progress"), IbkrFlexFixture.Report);
        var report = await client.GetReportAsync(User, FlexCreds, false, default);
        Assert.Single(report.Statements);
        Assert.Equal(4, handler.Calls.Count); // 1 SendRequest + 3 GetStatement
    }

    [Fact]
    public async Task Cliente_Ibkr_si_nunca_termina_avisa_que_pruebe_en_un_minuto()
    {
        var (client, _, _, _) = NewFlexClient(IbkrFlexFixture.Fail("1019", "Statement generation in progress"));
        var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() => client.GetReportAsync(User, FlexCreds, false, default));
        Assert.Contains("todavía está generando el reporte", ex.Message);
    }

    [Theory]
    [InlineData("1012", "venció")]
    [InlineData("1015", "no reconoce el token")]
    [InlineData("1014", "Query ID")]
    [InlineData("1013", "restricción de IP")]
    public async Task Cliente_Ibkr_credencial_rechazada_es_invalida_en_SendRequest(string code, string fragment)
    {
        var handler = new ScriptedHandler { Respond = _ => (HttpStatusCode.OK, IbkrFlexFixture.Fail(code, "x")) };
        var client = new IbkrFlexClient(new Factory(handler), null, Array.Empty<TimeSpan>());
        var ex = await Assert.ThrowsAsync<IbkrCredentialInvalidException>(() => client.GetReportAsync(User, FlexCreds, false, default));
        Assert.Contains(fragment, ex.Message);
        Assert.Equal("broker_credential_invalid", IbkrCredentialInvalidException.Code);
        Assert.DoesNotContain(FlexToken, ex.Message);
    }

    [Fact]
    public async Task Cliente_Ibkr_credencial_rechazada_en_GetStatement_tambien()
    {
        var (client, _, _, _) = NewFlexClient(IbkrFlexFixture.Fail("1012", "Token has expired"));
        await Assert.ThrowsAsync<IbkrCredentialInvalidException>(() => client.GetReportAsync(User, FlexCreds, false, default));
    }

    [Fact]
    public async Task Cliente_Ibkr_errores_ajenos_salen_como_upstream_sin_la_url_ni_el_token()
    {
        var casos = new (HttpStatusCode, string)[]
        {
            (HttpStatusCode.OK, IbkrFlexFixture.Fail("1003", "Statement is not available.")),
            (HttpStatusCode.BadGateway, "<html>bad gateway</html>"),
            (HttpStatusCode.OK, "esto no es xml <<<"),
        };
        foreach (var caso in casos)
        {
            var handler = new ScriptedHandler { Respond = _ => caso };
            var client = new IbkrFlexClient(new Factory(handler), null, Array.Empty<TimeSpan>());
            var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() => client.GetReportAsync(User, FlexCreds, false, default));
            Assert.DoesNotContain(FlexToken, ex.Message);
            Assert.DoesNotContain("http", ex.Message);
        }
        var fail = new ScriptedHandler { Throw = new HttpRequestException("fallo en https://x/?t=" + FlexToken) };
        var ex2 = await Assert.ThrowsAsync<UpstreamSourceException>(() =>
            new IbkrFlexClient(new Factory(fail), null, Array.Empty<TimeSpan>()).GetReportAsync(User, FlexCreds, false, default));
        Assert.DoesNotContain(FlexToken, ex2.Message);
    }

    [Fact]
    public async Task Cliente_Ibkr_cache_de_diez_minutos_no_repite_el_pedido_y_Forget_lo_limpia()
    {
        var (client, handler, _, advance) = NewFlexClient(IbkrFlexFixture.Report);
        await client.GetReportAsync(User, FlexCreds, true, default);
        await client.GetReportAsync(User, FlexCreds, true, default);
        Assert.Equal(2, handler.Calls.Count); // sólo el primer SendRequest + GetStatement

        await client.GetReportAsync(User, FlexCreds, false, default); // sin cache: vuelve a pedir
        Assert.Equal(4, handler.Calls.Count);

        client.Forget(User);
        await client.GetReportAsync(User, FlexCreds, true, default);
        Assert.Equal(6, handler.Calls.Count);

        advance(TimeSpan.FromMinutes(11));
        await client.GetReportAsync(User, FlexCreds, true, default);
        Assert.Equal(8, handler.Calls.Count);
    }

    // ── servicio IBKR ─────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Ibkr_guarda_token_y_query_cifrados_y_queda_conectado_con_la_query_de_hint()
    {
        var (service, store, ibkr) = NewIbkrRig();
        var result = await service.SetIbkrCredentialsAsync(User, "  " + FlexToken + " ", FlexQuery, default);
        Assert.Equal(BrokerWriteOutcome.Ok, result.Outcome);
        Assert.Equal(1, ibkr.Reports);
        Assert.Equal(1, ibkr.Forgets);
        Assert.DoesNotContain(FlexToken, store.Rows["ibkr"].SecretHint);
        Assert.Equal(FlexQuery, store.Rows["ibkr"].SecretHint);
        Assert.StartsWith("enc:", store.Rows["ibkr"].SecretCipher);

        var view = (await service.ListAsync(User, default)).Single(b => b.Id == "ibkr");
        Assert.Equal("connected", view.Status);
        Assert.Equal(FlexQuery, view.Hint);
        Assert.Equal("IBKR devolvió el reporte Flex.", view.LastCheck!.Message);
    }

    [Fact]
    public async Task Ibkr_si_lo_rechaza_no_guarda_y_devuelve_el_motivo()
    {
        var (service, store, ibkr) = NewIbkrRig();
        ibkr.Fails = new IbkrCredentialInvalidException("El token de Flex de IBKR venció; generá uno nuevo en el portal.");
        var (outcome, message) = await service.SetIbkrCredentialsAsync(User, FlexToken, FlexQuery, default);
        Assert.Equal(BrokerWriteOutcome.Rejected, outcome);
        Assert.Contains("venció", message);
        Assert.Empty(store.Rows);
    }

    [Fact]
    public async Task Ibkr_valida_los_campos_y_el_storage()
    {
        var (service, _, _) = NewIbkrRig();
        Assert.Equal(BrokerWriteOutcome.Invalid, (await service.SetIbkrCredentialsAsync(User, null, FlexQuery, default)).Outcome);
        Assert.Equal(BrokerWriteOutcome.Invalid, (await service.SetIbkrCredentialsAsync(User, FlexToken, "", default)).Outcome);
        Assert.Equal(BrokerWriteOutcome.Invalid, (await service.SetIbkrCredentialsAsync(User, FlexToken, "12ab", default)).Outcome);
        Assert.Equal(BrokerWriteOutcome.Invalid, (await service.SetIbkrCredentialsAsync(User, FlexToken, new string('1', 17), default)).Outcome);
        Assert.Equal(BrokerWriteOutcome.Invalid, (await service.SetIbkrCredentialsAsync(User, new string('t', 201), FlexQuery, default)).Outcome);
        var (sinBase, _, _) = NewIbkrRig(withStore: false);
        Assert.Equal(BrokerWriteOutcome.StorageUnavailable, (await sinBase.SetIbkrCredentialsAsync(User, FlexToken, FlexQuery, default)).Outcome);
    }

    [Fact]
    public async Task Ibkr_una_caida_en_el_guardado_sale_como_upstream_y_no_guarda()
    {
        var (service, store, ibkr) = NewIbkrRig();
        ibkr.Fails = new UpstreamSourceException("IBKR", "respondió 502.");
        await Assert.ThrowsAsync<UpstreamSourceException>(() => service.SetIbkrCredentialsAsync(User, FlexToken, FlexQuery, default));
        Assert.Empty(store.Rows);
    }

    [Fact]
    public async Task Ibkr_cartera_sin_credencial_es_no_vinculada_y_con_credencial_devuelve_el_reporte()
    {
        var (service, _, ibkr) = NewIbkrRig();
        await Assert.ThrowsAsync<BrokerAccountNotLinkedException>(() => service.GetIbkrPortfolioAsync(User, default));

        await service.SetIbkrCredentialsAsync(User, FlexToken, FlexQuery, default);
        var portfolio = await service.GetIbkrPortfolioAsync(User, default);
        Assert.Equal("IBKR Flex", portfolio.Source);
        Assert.Equal(2, portfolio.Positions.Count);

        ibkr.Fails = new IbkrCredentialInvalidException("x");
        await Assert.ThrowsAsync<IbkrCredentialInvalidException>(() => service.GetIbkrPortfolioAsync(User, default));
    }

    [Fact]
    public async Task Ibkr_prueba_de_conexion_missing_ok_e_invalid_y_borrar_limpia()
    {
        var (service, store, ibkr) = NewIbkrRig();
        Assert.Equal("missing", (await service.TestAsync(User, "ibkr", default))!.Status);

        await service.SetIbkrCredentialsAsync(User, FlexToken, FlexQuery, default);
        var ok = await service.TestAsync(User, "ibkr", default);
        Assert.True(ok!.Ok);

        ibkr.Fails = new IbkrCredentialInvalidException("El token de Flex de IBKR venció; generá uno nuevo en el portal.");
        var bad = await service.TestAsync(User, "ibkr", default);
        Assert.Equal("invalid", bad!.Status);
        Assert.Equal("invalid", (await service.ListAsync(User, default)).Single(b => b.Id == "ibkr").Status);

        var forgetsAntes = ibkr.Forgets;
        Assert.Equal(BrokerWriteOutcome.Ok, await service.DeleteIbkrCredentialsAsync(User, default));
        Assert.Equal(forgetsAntes + 1, ibkr.Forgets);
        Assert.Null(store.Rows["ibkr"].SecretCipher);
        Assert.Equal("missing", (await service.ListAsync(User, default)).Single(b => b.Id == "ibkr").Status);
    }

    // ── cartera consolidada ───────────────────────────────────────────────────────────────────────────────────

    private static DolarQuote Mep(decimal venta) => new("bolsa", "Bolsa", venta - 10m, venta, "2026-11-23T15:00:00.000Z", null);

    private static (AccountBalancesResponse, AccountPositionsResponse) TastyData(string direction = "Long") => (
        new AccountBalancesResponse { AccountNumber = "5WX1", CashBalance = 1000m, UpdatedAt = "2026-11-23T15:00:00.000+00:00" },
        new AccountPositionsResponse
        {
            Positions = new List<AccountPositionDto>
            {
                new() { AccountNumber = "5WX1", Symbol = "SPY", InstrumentType = "Equity", Quantity = 10m, QuantityDirection = direction, ClosePrice = 500m, AverageOpenPrice = 450m, Multiplier = 1m },
            },
        });

    private sealed class ConsolidatedRig
    {
        public FakeStore Store { get; } = new();
        public FakeIol Iol { get; } = new();
        public FakeIbkr Ibkr { get; } = new();
        public BrokersService Service { get; }

        public ConsolidatedRig(DolarQuote? mep, Func<(AccountBalancesResponse, AccountPositionsResponse)>? tasty)
        {
            Service = new BrokersService(Store, new FakeProtector(), Iol, Ibkr, null, NullLogger<BrokersService>.Instance,
                tastytradePortfolio: tasty == null ? null : _ => Task.FromResult(tasty()),
                mep: _ => Task.FromResult(mep));
        }

        public async Task ConnectAllAsync()
        {
            Store.TastytradeLinked = true;
            await Service.SetIolCredentialsAsync(User, "usuarioiol1", Password, default);
            await Service.SetIbkrCredentialsAsync(User, FlexToken, FlexQuery, default);
        }
    }

    private static IolPositions IolPos(string symbol, string currency, decimal value) => new()
    {
        Currency = currency,
        Positions = new List<IolPosition>
        {
            new() { Instrument = new IolInstrument { Symbol = symbol }, Quantity = 1m, MarketValue = new IolMarketValue { CurrentPrice = value }, CostBasis = new IolCostBasis { TotalCost = value }, ProfitLoss = new IolProfitLoss { UnrealizedPl = 0m } },
        },
    };

    [Fact]
    public async Task Consolidada_broker_excluido_no_se_pide_y_sale_excluded()
    {
        var rig = new ConsolidatedRig(null, () => TastyData());
        await rig.ConnectAllAsync();
        await rig.Service.SetIncludeAsync(User, "ibkr", false, default);
        var antes = rig.Ibkr.Reports;

        var r = await rig.Service.GetConsolidatedAsync(User, default);

        Assert.Equal(antes, rig.Ibkr.Reports);
        var slice = r.Brokers.Single(b => b.Id == "ibkr");
        Assert.Equal("excluded", slice.Status);
        Assert.Null(slice.TotalUsd);
        Assert.DoesNotContain(r.Positions, p => p.Broker == "ibkr");
    }

    [Fact]
    public async Task Consolidada_ibkr_caido_sale_error_y_los_otros_siguen_con_su_total()
    {
        var rig = new ConsolidatedRig(null, () => TastyData());
        await rig.ConnectAllAsync();
        rig.Ibkr.Fails = new UpstreamSourceException("IBKR", "Flex no responde.");
        rig.Iol.Us = new IolBalances { Usd = new IolCurrencyBalance { Currency = "USD", Totals = new IolTerms { T0 = 300m } } };

        var r = await rig.Service.GetConsolidatedAsync(User, default);

        var ibkr = r.Brokers.Single(b => b.Id == "ibkr");
        Assert.Equal("error", ibkr.Status);
        Assert.Contains("Flex no responde", ibkr.Message);
        var tasty = r.Brokers.Single(b => b.Id == "tastytrade");
        Assert.Equal("ok", tasty.Status);
        Assert.Equal(6000m, tasty.TotalUsd); // 10 x 500 + 1000 de saldo
        Assert.Equal(300m, r.Brokers.Single(b => b.Id == "iol").TotalUsd);
        Assert.Equal(6300m, r.TotalUsd);
    }

    [Fact]
    public async Task Consolidada_ars_a_usd_con_mep_125000_pesos_son_100_dolares()
    {
        var rig = new ConsolidatedRig(Mep(1250m), null);
        await rig.ConnectAllAsync();
        rig.Ibkr.Fails = new UpstreamSourceException("IBKR", "x");
        rig.Iol.Ar = new IolBalances { Ars = new IolCurrencyBalance { Currency = "ARS", Totals = new IolTerms { T0 = 125000m } } };

        var r = await rig.Service.GetConsolidatedAsync(User, default);

        var cash = Assert.Single(r.Cash);
        Assert.Equal(125000m, cash.Amount);
        Assert.Equal(100m, cash.AmountUsd);
        Assert.Equal(100m, r.Brokers.Single(b => b.Id == "iol").TotalUsd);
        Assert.Equal(1250m, r.Fx!.Rate);
        Assert.Contains("Pesos a dólares con el MEP (venta) de DolarAPI.", r.Notes);
        var tasty = r.Brokers.Single(b => b.Id == "tastytrade");
        Assert.Equal("error", tasty.Status); // sin handler de cartera
        Assert.Equal("No disponible en este servidor.", tasty.Message);
    }

    [Fact]
    public async Task Consolidada_sin_mep_los_pesos_quedan_null_con_warning_y_note()
    {
        var rig = new ConsolidatedRig(null, null);
        await rig.ConnectAllAsync();
        rig.Ibkr.Fails = new UpstreamSourceException("IBKR", "x");
        rig.Iol.Ar = new IolBalances
        {
            Ars = new IolCurrencyBalance { Currency = "ARS", Totals = new IolTerms { T0 = 125000m } },
            Usd = new IolCurrencyBalance { Currency = "USD", Totals = new IolTerms { T0 = 50m } },
        };

        var r = await rig.Service.GetConsolidatedAsync(User, default);

        Assert.Null(r.Fx);
        Assert.Null(r.Cash.Single(c => c.Currency == "ARS").AmountUsd);
        var iol = r.Brokers.Single(b => b.Id == "iol");
        Assert.Equal("partial", iol.Status);
        Assert.Single(iol.Warnings, "ARS sin convertir: no suma al total.");
        Assert.Equal(50m, iol.TotalUsd);
        Assert.Contains("Sin cotización MEP: los pesos no se pasan a dólares.", r.Notes);
    }

    private sealed class SelectiveIol : IIolClient
    {
        private readonly FakeIol _inner;
        private readonly string _failCountry;
        public SelectiveIol(FakeIol inner, string failCountry) { _inner = inner; _failCountry = failCountry; }
        public Task LoginAsync(Guid userId, IolCredentials credentials, CancellationToken ct) => _inner.LoginAsync(userId, credentials, ct);
        public Task<IolBalances> GetBalancesAsync(Guid userId, IolCredentials credentials, string country, CancellationToken ct) =>
            country == _failCountry ? Task.FromException<IolBalances>(new UpstreamSourceException("IOL", "sin respuesta.")) : _inner.GetBalancesAsync(userId, credentials, country, ct);
        public Task<IolPositions> GetPositionsAsync(Guid userId, IolCredentials credentials, string country, CancellationToken ct) =>
            country == _failCountry ? Task.FromException<IolPositions>(new UpstreamSourceException("IOL", "sin respuesta.")) : _inner.GetPositionsAsync(userId, credentials, country, ct);
        public void Forget(Guid userId) => _inner.Forget(userId);
    }

    [Fact]
    public async Task Consolidada_iol_con_cuenta_us_caida_sigue_con_ar_y_avisa()
    {
        var store = new FakeStore();
        var fake = new FakeIol
        {
            Ar = new IolBalances { Usd = new IolCurrencyBalance { Currency = "USD", Totals = new IolTerms { T0 = 70m } } },
            ArPositions = IolPos("AL30", "ARS", 50000m),
        };
        var service = new BrokersService(store, new FakeProtector(), new SelectiveIol(fake, "US"), new FakeIbkr(), null, NullLogger<BrokersService>.Instance);
        await service.SetIolCredentialsAsync(User, "usuarioiol1", Password, default);

        var p = await service.GetIolPortfolioAsync(User, default);

        Assert.Single(p.Warnings);
        Assert.StartsWith("Cuenta US de IOL: ", p.Warnings[0]);
        Assert.Contains(p.Balances, b => b.Account == "AR" && b.Total == 70m);
        Assert.Equal("AR", p.Positions.Single().Account);

        var slice = PortfolioConsolidator.FromIol(new BrokerView { Id = "iol", Name = "IOL" }, p, new FxView { Rate = 1000m });
        Assert.Equal("partial", slice.Slice.Status);
        Assert.Contains(p.Warnings[0], slice.Slice.Warnings);
        Assert.Equal(120m, slice.Slice.TotalUsd); // 70 USD + 50.000 ARS / 1000
    }

    [Fact]
    public async Task Consolidada_iol_con_las_dos_cuentas_caidas_relanza_la_primera_falla()
    {
        var (service, _, iol) = NewRig();
        await service.SetIolCredentialsAsync(User, "usuarioiol1", Password, default);
        iol.ReadFails = new UpstreamSourceException("IOL", "no se pudo conectar.");
        var ex = await Assert.ThrowsAsync<UpstreamSourceException>(() => service.GetIolPortfolioAsync(User, default));
        Assert.Contains("no se pudo conectar", ex.Message);
    }

    [Fact]
    public void Consolidada_fx_rate_to_base_convierte_euros_y_sin_tasa_avisa_una_sola_vez()
    {
        var xml = """
            <FlexQueryResponse><FlexStatements count="1">
              <FlexStatement accountId="U1" toDate="20261120" whenGenerated="20261121;163045"><AccountInformation currency="USD" />
                <OpenPositions>
                  <OpenPosition currency="EUR" assetCategory="STK" symbol="SAP" position="10" positionValue="1000" fifoPnlUnrealized="100" fxRateToBase="1.1" />
                  <OpenPosition currency="GBP" assetCategory="STK" symbol="BP" position="5" positionValue="500" />
                  <OpenPosition currency="GBP" assetCategory="STK" symbol="SHEL" position="5" positionValue="700" />
                </OpenPositions>
              </FlexStatement>
            </FlexStatements></FlexQueryResponse>
            """;
        var portfolio = IbkrPortfolioMapper.Map(Parse(xml));
        Assert.Equal(1.1m, portfolio.Positions.Single(p => p.Symbol == "SAP").FxRateToBase);

        var data = PortfolioConsolidator.FromIbkr(new BrokerView { Id = "ibkr", Name = "IBKR" }, portfolio, null);

        var sap = data.Positions.Single(p => p.Symbol == "SAP");
        Assert.Equal(1100m, sap.MarketValueUsd);
        Assert.Equal(110m, sap.PnlUsd);
        Assert.Null(data.Positions.Single(p => p.Symbol == "BP").MarketValueUsd);
        Assert.Equal(1100m, data.Slice.TotalUsd);
        Assert.Equal("partial", data.Slice.Status);
        Assert.Single(data.Slice.Warnings, w => w == "GBP sin convertir: no suma al total.");
        Assert.Contains("Dato del cierre del 2026-11-20.", data.Slice.Warnings);
        Assert.True(data.Slice.IsClose);
    }

    [Fact]
    public void Consolidada_tastytrade_corto_tiene_valor_y_pnl_con_signo()
    {
        var (balances, positions) = TastyData("Short");
        var data = PortfolioConsolidator.FromTastytrade(new BrokerView { Id = "tastytrade", Name = "Tastytrade" }, balances, positions, null);

        var p = Assert.Single(data.Positions);
        Assert.Equal(-5000m, p.MarketValue);
        Assert.Equal(-5000m, p.MarketValueUsd);
        Assert.Equal(-500m, p.Pnl); // (500 - 450) x 10 x -1
        Assert.Equal(450m, p.AverageCost);
        Assert.Equal(-4000m, data.Slice.TotalUsd); // -5000 + 1000 de saldo
        Assert.Equal(DateTimeKind.Utc, data.Slice.AsOf!.Value.Kind);
    }

    [Theory]
    [InlineData(100, "MEP", 1250, 100)]
    [InlineData(100, "ccl", 1250, 100)]
    [InlineData(125000, "ARS", 1250, 100)]
    [InlineData(10, "EUR", 0, 11)]
    public void Consolidada_ToUsd_reglas(double amount, string currency, double mep, double expected)
    {
        var fx = mep > 0 ? new FxView { Rate = (decimal)mep } : null;
        Assert.Equal((decimal)expected, PortfolioConsolidator.ToUsd((decimal)amount, currency, fx, currency == "EUR" ? 1.1m : null, "USD"));
        Assert.Null(PortfolioConsolidator.ToUsd(10m, "EUR", fx, 1.1m, "EUR")); // base no USD
        Assert.Null(PortfolioConsolidator.ToUsd(null, "USD", fx, null, "USD"));
    }

    [Fact]
    public async Task Consolidada_no_conectados_salen_missing_y_credencial_rechazada_invalid()
    {
        var rig = new ConsolidatedRig(null, null);
        var vacio = await rig.Service.GetConsolidatedAsync(User, default);
        Assert.All(vacio.Brokers.Where(b => b.Id is "iol" or "ibkr" or "tastytrade"), b => Assert.Equal("missing", b.Status));
        Assert.Contains("Conectalo en Configuración", vacio.Brokers.First(b => b.Id == "iol").Message);
        Assert.Null(vacio.TotalUsd);

        await rig.ConnectAllAsync();
        rig.Ibkr.Fails = new IbkrCredentialInvalidException("El token venció.");
        var r = await rig.Service.GetConsolidatedAsync(User, default);
        var ibkr = r.Brokers.Single(b => b.Id == "ibkr");
        Assert.Equal("invalid", ibkr.Status);
        Assert.Contains("Revisá la credencial", ibkr.Message);
    }
}
