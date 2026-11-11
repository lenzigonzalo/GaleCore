using System.Net;
using DataFeed.Application.App.Agents;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Repositories.Entities;

namespace DataFeed.Tests;

/// <summary>WS-0079 — agentes que corren solos: clave, reporte, token de disparo, ejecución sin PC y listado.</summary>
public class AgentsTests
{
    private static readonly Guid Ana = Guid.NewGuid();
    private static readonly Guid Beto = Guid.NewGuid();
    private const string Agent = "oportunidades";
    private const string Trigger = "trig_123";
    private const string Token = "sk-routine-abcdefgh1234";

    // ── fakes ──────────────────────────────────────────────────────────────────────────────────────────────────

    private sealed class FakeProtector : ITokenProtector
    {
        public string Protect(string plaintext) => "enc:" + new string(plaintext.Reverse().ToArray());
        public string Unprotect(string ciphertext) => new string(ciphertext["enc:".Length..].Reverse().ToArray());
    }

    private sealed class FakeTime : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
        public void Advance(TimeSpan t) => Now += t;
    }

    private sealed class FakeFire : IRoutineFireClient
    {
        public FireResult Result { get; set; } = new(FireOutcome.Ok, "sess_1", "https://claude.ai/code/sess_1");
        public int Calls { get; private set; }
        public string? LastToken { get; private set; }
        public Task<FireResult> FireAsync(string triggerId, string token, string? text, CancellationToken ct)
        {
            Calls++;
            LastToken = token;
            return Task.FromResult(Result);
        }
    }

    private sealed class FakeStore : IAgentStore
    {
        public Dictionary<Guid, AgentKeyRow> Keys { get; } = new();
        public HashSet<(Guid, string)> Agents { get; } = new();
        public Dictionary<(Guid, string), AgentFireTokenRow> Tokens { get; } = new();
        public List<AgentRun> Runs { get; } = new();
        public List<AgentSkillRow> Space { get; } = new();

        // Devuelve a propósito más de lo que corresponde: el servicio es quien filtra kind y visibilidad.
        public Task<IReadOnlyList<AgentSkillRow>> GetSkillsAsync(Guid o, string key, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<AgentSkillRow>>(Space.Where(s => s.Key == key).ToList());

        public Task<AgentKeyRow?> GetKeyByOwnerAsync(Guid o, CancellationToken ct) => Task.FromResult(Keys.GetValueOrDefault(o));
        public Task<AgentKeyRow?> GetKeyByHashAsync(string h, CancellationToken ct) => Task.FromResult(Keys.Values.FirstOrDefault(k => k.KeyHash == h));
        public Task UpsertKeyAsync(Guid o, string h, string hint, DateTime now, CancellationToken ct) { Keys[o] = new(o, h, hint, now); return Task.CompletedTask; }
        public Task<bool> DeleteKeyAsync(Guid o, CancellationToken ct) => Task.FromResult(Keys.Remove(o));
        public Task<bool> AgentExistsAsync(Guid o, string a, CancellationToken ct) => Task.FromResult(Agents.Contains((o, a)));
        public Task<AgentFireTokenRow?> GetFireTokenAsync(Guid o, string a, CancellationToken ct) => Task.FromResult(Tokens.GetValueOrDefault((o, a)));
        public Task UpsertFireTokenAsync(Guid o, string a, string t, string c, string h, DateTime now, CancellationToken ct)
        { Tokens[(o, a)] = new(o, a, t, c, h, now, null); return Task.CompletedTask; }
        public Task<bool> DeleteFireTokenAsync(Guid o, string a, CancellationToken ct) => Task.FromResult(Tokens.Remove((o, a)));
        public Task MarkFiredAsync(Guid o, string a, DateTime at, CancellationToken ct)
        { if (Tokens.TryGetValue((o, a), out var t)) Tokens[(o, a)] = t with { LastFiredAt = at }; return Task.CompletedTask; }
        public Task<AgentRun> AddRunAsync(AgentRun r, CancellationToken ct) { Runs.Add(r); return Task.FromResult(r); }
        public Task UpdateRunAsync(AgentRun r, CancellationToken ct) => Task.CompletedTask; // la misma instancia
        public Task<AgentRun?> FindOpenManualAsync(Guid o, string a, string? trig, DateTime since, CancellationToken ct) =>
            Task.FromResult(Runs.Where(r => r.OwnerId == o && r.AgentKey == a && r.Origin == "manual" && r.Status == "requested"
                && r.TriggerId == trig && r.RequestedAt >= since).OrderByDescending(r => r.RequestedAt).FirstOrDefault());
        public Task<IReadOnlyList<AgentRun>> ListRunsAsync(Guid o, string a, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<AgentRun>>(Runs.Where(r => r.OwnerId == o && r.AgentKey == a).OrderByDescending(r => r.CreatedAt).ToList());
        public Task DeleteRunsAsync(IReadOnlyCollection<Guid> ids, CancellationToken ct) { Runs.RemoveAll(r => ids.Contains(r.Id)); return Task.CompletedTask; }
        public List<AgentAlert> Alerts { get; } = new();
        public Task<int> AddNewAlertsAsync(Guid o, string a, Guid runId, IReadOnlyList<(string AlertId, string Title)> alerts, DateTime now, CancellationToken ct)
        {
            var fresh = alerts.Where(x => !Alerts.Any(e => e.OwnerId == o && e.AgentKey == a && e.AlertId == x.AlertId)).DistinctBy(x => x.AlertId).ToList();
            Alerts.AddRange(fresh.Select(x => new AgentAlert { Id = Guid.NewGuid(), OwnerId = o, AgentKey = a, AlertId = x.AlertId, Title = x.Title, RunId = runId, CreatedAt = now }));
            return Task.FromResult(fresh.Count);
        }
        public Task<IReadOnlyList<AgentAlert>> ListAlertsAsync(Guid o, DateTime since, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<AgentAlert>>(Alerts.Where(x => x.OwnerId == o && x.CreatedAt >= since).OrderByDescending(x => x.CreatedAt).ToList());
        public Task DeleteAlertsBeforeAsync(Guid o, DateTime before, CancellationToken ct) { Alerts.RemoveAll(x => x.OwnerId == o && x.CreatedAt < before); return Task.CompletedTask; }
    }

    private sealed record Rig(AgentsService Svc, FakeStore Store, FakeFire Fire, FakeTime Time);

    private static Rig NewRig()
    {
        var store = new FakeStore();
        store.Agents.Add((Ana, Agent));
        var fire = new FakeFire();
        var time = new FakeTime();
        return new Rig(new AgentsService(store, new FakeProtector(), fire, time), store, fire, time);
    }

    private static ReportInput Report(string status = "ok", string? summary = "todo bien", string? trigger = null) =>
        new(status, summary, null, trigger, null, null);

    // ── lectura de skills con la clave de agentes (WS-0099) ───────────────────────────────────────────────────

    private static AgentSkillRow Skill(Guid owner, string name, string kind = "skill", string visibility = "private", string content = "{}", int hour = 0) =>
        new(kind, "cierre", "Cierre", content, "json", visibility, 1, new DateTime(2026, 11, 9, hour, 0, 0, DateTimeKind.Utc), name, owner);

    [Fact]
    public async Task LaClaveLeeUnaSkillPropiaYPrefiereLaPropiaSobreUnaCompartida()
    {
        var r = NewRig();
        r.Store.Space.Add(Skill(Beto, "beto", visibility: "shared", content: "{de-beto}", hour: 9));
        r.Store.Space.Add(Skill(Ana, "ana", content: "{de-ana}"));

        var own = await r.Svc.GetSkillAsync(Ana, "cierre", default);

        Assert.Equal(AgentOutcome.Ok, own.Outcome);
        Assert.Equal("{de-ana}", own.Value!.Content);
        Assert.Equal("ana", own.Value.Owner);
    }

    [Fact]
    public async Task LaClaveLeeUnaSkillCompartidaPorOtro()
    {
        var r = NewRig();
        r.Store.Space.Add(Skill(Beto, "beto", visibility: "shared", content: "{de-beto}"));

        var shared = await r.Svc.GetSkillAsync(Ana, "cierre", default);

        Assert.Equal(AgentOutcome.Ok, shared.Outcome);
        Assert.Equal("beto", shared.Value!.Owner);
        Assert.Equal("{de-beto}", shared.Value.Content);
    }

    [Fact]
    public async Task UnaSkillPrivadaDeOtroUnKindDistintoOUnaInexistenteSonNotFound()
    {
        var r = NewRig();
        r.Store.Space.Add(Skill(Beto, "beto", visibility: "private"));
        r.Store.Space.Add(Skill(Beto, "beto", kind: "memory", visibility: "shared"));
        r.Store.Space.Add(Skill(Ana, "ana", kind: "agent"));

        Assert.Equal(AgentOutcome.NotFound, (await r.Svc.GetSkillAsync(Ana, "cierre", default)).Outcome);
        Assert.Equal(AgentOutcome.NotFound, (await r.Svc.GetSkillAsync(Ana, "otra", default)).Outcome);
    }

    [Fact]
    public async Task UnaClaveInvalidaNoResuelveDuenoYPorEndeNoLeeSkills()
    {
        var r = NewRig();
        r.Store.Space.Add(Skill(Ana, "ana"));

        Assert.Null(await r.Svc.ResolveKeyAsync("gca_inventada", default));
        Assert.Null(await r.Svc.ResolveKeyAsync("", default));
    }

    // ── clave de agentes ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GenerarGuardaSoloElHashYLosUltimos4()
    {
        var r = NewRig();
        var k = await r.Svc.GenerateKeyAsync(Ana, default);

        Assert.StartsWith("gca_", k.Key);
        var row = r.Store.Keys[Ana];
        Assert.Equal(AgentsService.Hash(k.Key), row.KeyHash);
        Assert.Equal(k.Key[^4..], row.KeyHint);
        Assert.DoesNotContain(k.Key, row.KeyHash + row.KeyHint);
        var st = await r.Svc.KeyStatusAsync(Ana, default);
        Assert.True(st.Exists);
        Assert.Equal(row.KeyHint, st.Hint);
    }

    [Fact]
    public async Task RegenerarInvalidaLaAnteriorYRevocarLaBorra()
    {
        var r = NewRig();
        var a = await r.Svc.GenerateKeyAsync(Ana, default);
        var b = await r.Svc.GenerateKeyAsync(Ana, default);

        Assert.NotEqual(a.Key, b.Key);
        Assert.Null(await r.Svc.ResolveKeyAsync(a.Key, default));
        Assert.Equal(Ana, await r.Svc.ResolveKeyAsync(b.Key, default));

        Assert.True(await r.Svc.RevokeKeyAsync(Ana, default));
        Assert.Null(await r.Svc.ResolveKeyAsync(b.Key, default));
        Assert.False((await r.Svc.KeyStatusAsync(Ana, default)).Exists);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("gca_inventada")]
    public async Task UnaClaveInvalidaNoResuelveDueno(string? key)
    {
        var r = NewRig();
        await r.Svc.GenerateKeyAsync(Ana, default);
        Assert.Null(await r.Svc.ResolveKeyAsync(key, default));
    }

    // ── reporte ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ReporteDeUnAgenteAjenoOInexistenteEs404()
    {
        var r = NewRig();
        var ajeno = await r.Svc.ReportAsync(Beto, Agent, Report(), default);       // Beto no tiene ese agente
        var inexistente = await r.Svc.ReportAsync(Ana, "otro", Report(), default);
        Assert.Equal(AgentOutcome.NotFound, ajeno.Outcome);
        Assert.Equal(AgentOutcome.NotFound, inexistente.Outcome);
        Assert.Empty(r.Store.Runs);
    }

    [Fact]
    public async Task ReporteValidoCreaFilaScheduleConElEstadoReportado()
    {
        var r = NewRig();
        var res = await r.Svc.ReportAsync(Ana, Agent, new ReportInput("skipped", "mercado cerrado", "market_closed", Trigger, null, null), default);

        Assert.Equal(AgentOutcome.Ok, res.Outcome);
        var run = Assert.Single(r.Store.Runs);
        Assert.Equal("schedule", run.Origin);
        Assert.Equal("skipped", run.Status);
        Assert.Equal("market_closed", run.ReasonCode);
        Assert.Equal(Trigger, run.TriggerId);
        Assert.NotNull(run.FinishedAt);
    }

    [Theory]
    [InlineData("")]
    [InlineData("requested")]
    [InlineData("no_report")]
    public async Task StatusInvalidoEs400(string status)
    {
        var r = NewRig();
        Assert.Equal(AgentOutcome.Invalid, (await r.Svc.ReportAsync(Ana, Agent, Report(status), default)).Outcome);
    }

    [Fact]
    public async Task SummaryDeMasDe4000CaracteresEs400YDe4000Pasa()
    {
        var r = NewRig();
        Assert.Equal(AgentOutcome.Invalid, (await r.Svc.ReportAsync(Ana, Agent, Report(summary: new string('x', 4001)), default)).Outcome);
        Assert.Empty(r.Store.Runs);
        Assert.Equal(AgentOutcome.Ok, (await r.Svc.ReportAsync(Ana, Agent, Report(summary: new string('x', 4000)), default)).Outcome);
    }

    [Fact]
    public async Task SeConservanLasUltimas50PorAgente()
    {
        var r = NewRig();
        r.Store.Agents.Add((Ana, "otro"));
        await r.Svc.ReportAsync(Ana, "otro", Report(summary: "de otro agente"), default);
        for (var i = 0; i < 55; i++)
        {
            r.Time.Advance(TimeSpan.FromMinutes(1));
            await r.Svc.ReportAsync(Ana, Agent, Report(summary: $"corrida {i}"), default);
        }

        var propias = r.Store.Runs.Where(x => x.AgentKey == Agent).ToList();
        Assert.Equal(50, propias.Count);
        Assert.DoesNotContain(propias, x => x.Summary == "corrida 0");
        Assert.Contains(propias, x => x.Summary == "corrida 54");
        Assert.Single(r.Store.Runs, x => x.AgentKey == "otro"); // el tope es por agente
    }

    [Fact]
    public async Task ElReporteCompletaLaFilaManualPedida()
    {
        var r = NewRig();
        await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, Token, default);
        var run = (await r.Svc.RunAsync(Ana, Agent, null, default)).Value!;
        r.Time.Advance(TimeSpan.FromMinutes(10));

        var res = await r.Svc.ReportAsync(Ana, Agent, Report("ok", "listo", Trigger), default);

        Assert.Equal(run.Id, res.Value!.Id);
        var fila = Assert.Single(r.Store.Runs);
        Assert.Equal("manual", fila.Origin);
        Assert.Equal("ok", fila.Status);
        Assert.Equal("listo", fila.Summary);
        Assert.Equal("https://claude.ai/code/sess_1", fila.SessionUrl);
    }

    [Fact]
    public async Task UnaManualPedidaHaceMasDe2HorasNoSeCompletaYSeCreaUnaSchedule()
    {
        var r = NewRig();
        await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, Token, default);
        await r.Svc.RunAsync(Ana, Agent, null, default);
        r.Time.Advance(TimeSpan.FromHours(2) + TimeSpan.FromMinutes(1));

        await r.Svc.ReportAsync(Ana, Agent, Report("ok", "x", Trigger), default);

        Assert.Equal(2, r.Store.Runs.Count);
        Assert.Contains(r.Store.Runs, x => x.Origin == "schedule" && x.Status == "ok");
        Assert.Contains(r.Store.Runs, x => x.Origin == "manual" && x.Status == "requested");
    }

    [Fact]
    public async Task UnReporteConOtroTriggerNoCompletaLaManual()
    {
        var r = NewRig();
        await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, Token, default);
        await r.Svc.RunAsync(Ana, Agent, null, default);

        await r.Svc.ReportAsync(Ana, Agent, Report("ok", "x", "otro_trigger"), default);

        Assert.Equal(2, r.Store.Runs.Count);
    }

    // ── token de disparo ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ElTokenSeGuardaCifradoYNoVuelveEnLasRespuestas()
    {
        var r = NewRig();
        var set = await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, Token, default);
        var get = await r.Svc.GetFireTokenAsync(Ana, Agent, default);

        var row = r.Store.Tokens[(Ana, Agent)];
        Assert.NotEqual(Token, row.TokenCipher);
        Assert.DoesNotContain(Token, row.TokenCipher);
        Assert.Equal("1234", row.TokenHint);
        foreach (var s in new[] { set.Value!, get.Value! })
        {
            Assert.True(s.Exists);
            Assert.Equal(Trigger, s.TriggerId);
            Assert.Equal("1234", s.TokenHint);
            Assert.DoesNotContain(Token, System.Text.Json.JsonSerializer.Serialize(s));
        }
    }

    [Fact]
    public async Task BorrarElTokenLoQuitaYSinAgenteEs404()
    {
        var r = NewRig();
        await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, Token, default);
        Assert.Equal(AgentOutcome.Ok, (await r.Svc.DeleteFireTokenAsync(Ana, Agent, default)).Outcome);
        Assert.False((await r.Svc.GetFireTokenAsync(Ana, Agent, default)).Value!.Exists);
        Assert.Equal(AgentOutcome.NotFound, (await r.Svc.SetFireTokenAsync(Beto, Agent, Trigger, Token, default)).Outcome);
        Assert.Equal(AgentOutcome.Invalid, (await r.Svc.SetFireTokenAsync(Ana, Agent, "", Token, default)).Outcome);
        Assert.Equal(AgentOutcome.Invalid, (await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, " ", default)).Outcome);
    }

    // ── ejecutar sin PC ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RunDisparaConElTokenDescifradoYDejaUnaFilaManualRequested()
    {
        var r = NewRig();
        await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, Token, default);

        var res = await r.Svc.RunAsync(Ana, Agent, "hola", default);

        Assert.Equal(AgentOutcome.Ok, res.Outcome);
        Assert.Equal(Token, r.Fire.LastToken);
        Assert.Equal("manual", res.Value!.Origin);
        Assert.Equal("requested", res.Value.Status);
        Assert.Equal("sess_1", res.Value.SessionId);
        Assert.Equal("https://claude.ai/code/sess_1", res.Value.SessionUrl);
        Assert.Equal(Trigger, res.Value.TriggerId);
    }

    [Fact]
    public async Task RunSinTokenEs409YNoLlamaAAnthropic()
    {
        var r = NewRig();
        var res = await r.Svc.RunAsync(Ana, Agent, null, default);
        Assert.Equal(AgentOutcome.NoToken, res.Outcome);
        Assert.Equal("este agente no tiene token de disparo", res.Error);
        Assert.Equal(0, r.Fire.Calls);
    }

    [Fact]
    public async Task RunConUnAgenteAjenoEs404()
    {
        var r = NewRig();
        await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, Token, default);
        Assert.Equal(AgentOutcome.NotFound, (await r.Svc.RunAsync(Beto, Agent, null, default)).Outcome);
        Assert.Equal(0, r.Fire.Calls);
    }

    [Fact]
    public async Task UnDisparoCada5MinutosPorAgente()
    {
        var r = NewRig();
        await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, Token, default);
        Assert.Equal(AgentOutcome.Ok, (await r.Svc.RunAsync(Ana, Agent, null, default)).Outcome);

        r.Time.Advance(TimeSpan.FromMinutes(4));
        var limited = await r.Svc.RunAsync(Ana, Agent, null, default);
        Assert.Equal(AgentOutcome.RateLimited, limited.Outcome);
        Assert.InRange(limited.RetryAfterSeconds!.Value, 1, 60);
        Assert.Equal(1, r.Fire.Calls);

        r.Time.Advance(TimeSpan.FromMinutes(1));
        Assert.Equal(AgentOutcome.Ok, (await r.Svc.RunAsync(Ana, Agent, null, default)).Outcome);
        Assert.Equal(2, r.Fire.Calls);
    }

    [Fact]
    public async Task Un401DeAnthropicDiceQueElTokenNoAndaYNoCreaFilaNiConsumeElLimite()
    {
        var r = NewRig();
        await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, Token, default);
        r.Fire.Result = new FireResult(FireOutcome.Unauthorized);

        var res = await r.Svc.RunAsync(Ana, Agent, null, default);

        Assert.Equal(AgentOutcome.TokenRejected, res.Outcome);
        Assert.Equal("el token de esta rutina no anda: generá otro en claude.ai", res.Error);
        Assert.DoesNotContain(Token, res.Error);
        Assert.Empty(r.Store.Runs);
        r.Fire.Result = new FireResult(FireOutcome.Ok, "s", "u");
        Assert.Equal(AgentOutcome.Ok, (await r.Svc.RunAsync(Ana, Agent, null, default)).Outcome);
    }

    [Fact]
    public async Task UnaRutinaPausadaDaRoutinePausedYNoConsumeElLimite()
    {
        var r = NewRig();
        await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, Token, default);
        r.Fire.Result = new FireResult(FireOutcome.Paused);

        var res = await r.Svc.RunAsync(Ana, Agent, null, default);

        Assert.Equal(AgentOutcome.RoutinePaused, res.Outcome);
        Assert.Equal("la rutina está pausada: activala en claude.ai", res.Error);
        Assert.Empty(r.Store.Runs);
        r.Fire.Result = new FireResult(FireOutcome.Ok, "s", "u");
        Assert.Equal(AgentOutcome.Ok, (await r.Svc.RunAsync(Ana, Agent, null, default)).Outcome);
    }

    [Fact]
    public async Task OtroErrorDeAnthropicEsUpstreamFailedSinElToken()
    {
        var r = NewRig();
        await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, Token, default);
        r.Fire.Result = new FireResult(FireOutcome.Failed, Error: "Anthropic respondió 500");

        var res = await r.Svc.RunAsync(Ana, Agent, null, default);

        Assert.Equal(AgentOutcome.UpstreamFailed, res.Outcome);
        Assert.DoesNotContain(Token, res.Error);
        Assert.Empty(r.Store.Runs);
    }

    // ── listado y no_report ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task UnaManualSinReporteA30MinutosApareceComoNoReport()
    {
        var r = NewRig();
        await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, Token, default);
        await r.Svc.RunAsync(Ana, Agent, null, default);

        r.Time.Advance(TimeSpan.FromMinutes(29));
        Assert.Equal("requested", (await r.Svc.ListRunsAsync(Ana, Agent, default)).Value![0].Status);

        r.Time.Advance(TimeSpan.FromMinutes(1));
        Assert.Equal("no_report", (await r.Svc.ListRunsAsync(Ana, Agent, default)).Value![0].Status);
        Assert.Equal("requested", r.Store.Runs[0].Status); // se deriva al leer, no se guarda
    }

    [Fact]
    public async Task ElListadoVieneMasRecientePrimeroYSoloDeUnoMismo()
    {
        var r = NewRig();
        for (var i = 0; i < 3; i++)
        {
            r.Time.Advance(TimeSpan.FromMinutes(1));
            await r.Svc.ReportAsync(Ana, Agent, Report(summary: $"n{i}"), default);
        }
        var list = (await r.Svc.ListRunsAsync(Ana, Agent, default)).Value!;
        Assert.Equal(new[] { "n2", "n1", "n0" }, list.Select(x => x.Summary));
        Assert.Equal(AgentOutcome.NotFound, (await r.Svc.ListRunsAsync(Beto, Agent, default)).Outcome);
    }

    // ── resultado de la skill y avisos (WS-0099 C) ─────────────────────────────────────────────────────────────

    private static ReportInput WithResult(string status, string? result, params (string Id, string Title)[] alerts) =>
        new(status, "resumen", null, null, null, null, result, alerts.Select(a => new AlertInput(a.Id, a.Title)).ToList());

    private const string GoodResult = "{\"skill\":\"cierre\",\"version\":2,\"ok\":true,\"error\":null,\"salida\":{\"valores\":{\"spy\":600}}}";

    [Fact]
    public async Task ElReporteGuardaElResultadoYLoDevuelveEnLaVista()
    {
        var r = NewRig();
        var res = await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", GoodResult), default);
        Assert.Equal(GoodResult, res.Value!.ResultJson);
        Assert.Equal(GoodResult, (await r.Svc.ListRunsAsync(Ana, Agent, default)).Value![0].ResultJson);
    }

    [Fact]
    public async Task UnOkConElResultadoFallidoQuedaError()
    {
        var r = NewRig();
        var res = await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", "{\"ok\":false,\"error\":\"boom\"}", ("a1", "Rompió")), default);
        Assert.Equal("error", res.Value!.Status);
        Assert.Empty(r.Store.Alerts); // sin cálculo no hay aviso
    }

    [Fact]
    public async Task UnAvisoSaleUnaSolaVezPorIdYOtroIdAvisaDeNuevo()
    {
        var r = NewRig();
        await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", GoodResult, ("ruptura-1", "SPY rompió")), default);
        await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", GoodResult, ("ruptura-1", "SPY rompió")), default);
        Assert.Single(r.Store.Alerts);
        await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", GoodResult, ("ruptura-2", "SPY rompió otra vez")), default);
        Assert.Equal(2, r.Store.Alerts.Count);
        Assert.Equal(3, r.Store.Runs.Count(x => x.ResultJson == GoodResult)); // cada corrida con su resultado
    }

    [Fact]
    public async Task UnaCorridaQueNoTerminoOkNoDejaAvisos()
    {
        var r = NewRig();
        await r.Svc.ReportAsync(Ana, Agent, WithResult("error", GoodResult, ("a1", "x")), default);
        await r.Svc.ReportAsync(Ana, Agent, WithResult("skipped", null, ("a2", "x")), default);
        Assert.Empty(r.Store.Alerts);
    }

    [Fact]
    public async Task LosLimitesDeResultadoYAvisosSon400()
    {
        var r = NewRig();
        var big = "{\"x\":\"" + new string('a', AgentRun.MaxResultLength) + "\"}";
        Assert.Equal(AgentOutcome.Invalid, (await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", big), default)).Outcome);
        var many = Enumerable.Range(0, 11).Select(i => ($"i{i}", "t")).ToArray();
        Assert.Equal(AgentOutcome.Invalid, (await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", GoodResult, many), default)).Outcome);
        Assert.Equal(AgentOutcome.Invalid, (await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", GoodResult, (new string('i', 101), "t")), default)).Outcome);
        Assert.Equal(AgentOutcome.Invalid, (await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", GoodResult, ("i", new string('t', 201))), default)).Outcome);
        Assert.Empty(r.Store.Runs);
        var ten = Enumerable.Range(0, 10).Select(i => ($"i{i}", "t")).ToArray();
        Assert.Equal(AgentOutcome.Ok, (await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", GoodResult, ten), default)).Outcome);
        Assert.Equal(10, r.Store.Alerts.Count);
    }

    [Fact]
    public async Task ElListadoDeAvisosSonLosDeLosUltimos7DiasSoloDelDueno()
    {
        var r = NewRig();
        r.Store.Agents.Add((Beto, Agent));
        await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", GoodResult, ("viejo", "Viejo")), default);
        r.Time.Advance(TimeSpan.FromDays(8));
        await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", GoodResult, ("nuevo", "Nuevo")), default);
        await r.Svc.ReportAsync(Beto, Agent, WithResult("ok", GoodResult, ("de-beto", "Beto")), default);

        var list = await r.Svc.ListAlertsAsync(Ana, default);
        var one = Assert.Single(list);
        Assert.Equal(("nuevo", Agent, "Nuevo"), (one.AlertId, one.AgentKey, one.Title));
    }

    [Fact]
    public async Task LosAvisosSeConservan30DiasYLasCorridasQuedanRecortadasSoloEnSuResultado()
    {
        var r = NewRig();
        await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", GoodResult, ("viejo", "Viejo")), default);
        r.Time.Advance(TimeSpan.FromDays(31));
        await r.Svc.ReportAsync(Ana, Agent, WithResult("ok", GoodResult), default); // el recorte barre los avisos de más de 30 días
        Assert.Empty(r.Store.Alerts);
    }

    // ── aislamiento entre usuarios ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DosUsuariosNoVenNiDisparanLoDelOtro()
    {
        var r = NewRig();
        r.Store.Agents.Add((Beto, Agent)); // mismo nombre de agente, otro dueño
        var kAna = await r.Svc.GenerateKeyAsync(Ana, default);
        var kBeto = await r.Svc.GenerateKeyAsync(Beto, default);
        Assert.Equal(Ana, await r.Svc.ResolveKeyAsync(kAna.Key, default));
        Assert.Equal(Beto, await r.Svc.ResolveKeyAsync(kBeto.Key, default));

        await r.Svc.SetFireTokenAsync(Ana, Agent, Trigger, Token, default);
        await r.Svc.ReportAsync(Ana, Agent, Report(summary: "de Ana"), default);
        await r.Svc.ReportAsync(Beto, Agent, Report(summary: "de Beto"), default);

        Assert.Equal("de Ana", Assert.Single((await r.Svc.ListRunsAsync(Ana, Agent, default)).Value!).Summary);
        Assert.Equal("de Beto", Assert.Single((await r.Svc.ListRunsAsync(Beto, Agent, default)).Value!).Summary);
        Assert.False((await r.Svc.GetFireTokenAsync(Beto, Agent, default)).Value!.Exists);
        Assert.Equal(AgentOutcome.NoToken, (await r.Svc.RunAsync(Beto, Agent, null, default)).Outcome);
        Assert.Equal(0, r.Fire.Calls);
    }

    // ── cliente HTTP de Anthropic ──────────────────────────────────────────────────────────────────────────────

    private sealed class CapturingHandler : HttpMessageHandler
    {
        public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
        public string Body { get; set; } = "{}";
        public HttpRequestMessage? Request { get; private set; }
        public string? RequestBody { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            RequestBody = request.Content == null ? null : await request.Content.ReadAsStringAsync(ct);
            return new HttpResponseMessage(Status) { Content = new StringContent(Body) };
        }
    }

    private sealed class HandlerFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _h;
        public HandlerFactory(HttpMessageHandler h) => _h = h;
        public HttpClient CreateClient(string name) => new(_h, disposeHandler: false);
    }

    [Fact]
    public async Task ElClienteArmaElPedidoDeFireYLeeLaSesionDeFormaTolerante()
    {
        var h = new CapturingHandler { Body = "{\"id\":\"sess_9\",\"url\":\"https://claude.ai/code/sess_9\"}" };
        var res = await new AnthropicRoutineFireClient(new HandlerFactory(h)).FireAsync(Trigger, Token, "hola", default);

        Assert.Equal(FireOutcome.Ok, res.Outcome);
        Assert.Equal("sess_9", res.SessionId);
        Assert.Equal("https://claude.ai/code/sess_9", res.SessionUrl);
        Assert.Equal(HttpMethod.Post, h.Request!.Method);
        Assert.Equal("https://api.anthropic.com/v1/claude_code/routines/trig_123/fire", h.Request.RequestUri!.ToString());
        Assert.Equal("Bearer " + Token, h.Request.Headers.Authorization!.ToString());
        Assert.Equal("experimental-cc-routine-2026-04-01", h.Request.Headers.GetValues("anthropic-beta").Single());
        Assert.Equal("2023-06-01", h.Request.Headers.GetValues("anthropic-version").Single());
        Assert.Equal("{\"text\":\"hola\"}", h.RequestBody);
    }

    [Fact]
    public async Task ElClienteLeeLaRespuestaRealDeFire()
    {
        var h = new CapturingHandler { Body = "{\"type\":\"routine_fire\",\"claude_code_session_id\":\"cse_01U9\",\"claude_code_session_url\":\"https://claude.ai/code/cse_01U9\"}" };
        var res = await new AnthropicRoutineFireClient(new HandlerFactory(h)).FireAsync(Trigger, Token, null, default);
        Assert.Equal(FireOutcome.Ok, res.Outcome);
        Assert.Equal("cse_01U9", res.SessionId);
        Assert.Equal("https://claude.ai/code/cse_01U9", res.SessionUrl);
    }

    [Fact]
    public async Task ElClienteTraduceUn400DeRutinaPausada()
    {
        var h = new CapturingHandler { Status = HttpStatusCode.BadRequest, Body = "{\"error\":{\"message\":\"Routine is paused.\",\"reason\":\"routine_paused\",\"type\":\"invalid_request_error\"},\"request_id\":\"req_1\",\"type\":\"error\"}" };
        var res = await new AnthropicRoutineFireClient(new HandlerFactory(h)).FireAsync(Trigger, Token, null, default);
        Assert.Equal(FireOutcome.Paused, res.Outcome);
    }

    [Fact]
    public async Task ElClienteTraduceElBearerInvalidoReal()
    {
        var h = new CapturingHandler { Status = HttpStatusCode.Unauthorized, Body = "{\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"Invalid bearer token\"}}" };
        var res = await new AnthropicRoutineFireClient(new HandlerFactory(h)).FireAsync(Trigger, Token, null, default);
        Assert.Equal(FireOutcome.Unauthorized, res.Outcome);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, FireOutcome.Unauthorized)]
    [InlineData(HttpStatusCode.InternalServerError, FireOutcome.Failed)]
    public async Task ElClienteTraduceLosErroresDeAnthropic(HttpStatusCode status, FireOutcome expected)
    {
        var h = new CapturingHandler { Status = status, Body = "{\"error\":\"" + Token + "\"}" };
        var res = await new AnthropicRoutineFireClient(new HandlerFactory(h)).FireAsync(Trigger, Token, null, default);
        Assert.Equal(expected, res.Outcome);
        Assert.DoesNotContain(Token, res.Error ?? "");
        Assert.Equal("{}", h.RequestBody);
    }
}
