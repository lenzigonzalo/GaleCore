using System.Net;
using System.Text.Json;
using DataFeed.Application.App.Connections;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace DataFeed.Tests;

/// <summary>WS-0080 — claves de conexión: la lista no devuelve el valor, precedencia base &gt; servidor, permisos y mensajes de prueba.</summary>
public class ConnectionsTests
{
    private const string FredKey = "abcd1234efgh5678";

    // ── fakes ──────────────────────────────────────────────────────────────────────────────────────────────────

    private sealed class FakeProtector : ITokenProtector
    {
        public string Protect(string plaintext) => "enc:" + plaintext;
        public string Unprotect(string ciphertext) => ciphertext.StartsWith("enc:") ? ciphertext[4..] : throw new InvalidOperationException("no descifra");
    }

    private sealed class FakeStore : IPlatformConnectionStore
    {
        public Dictionary<string, PlatformConnectionRow> Rows { get; } = new();
        public HashSet<Guid> BrokerUsers { get; } = new();

        public Task<IReadOnlyList<PlatformConnectionRow>> LoadAllAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<PlatformConnectionRow>>(Rows.Values.ToList());

        public Task UpsertSecretAsync(string id, string cipher, string? hint, Guid? updatedBy, DateTime now, CancellationToken ct)
        {
            Rows[id] = new PlatformConnectionRow(id, cipher, hint, now, updatedBy, "Admin Uno", null, null, null);
            return Task.CompletedTask;
        }

        public Task DeleteAsync(string id, CancellationToken ct) { Rows.Remove(id); return Task.CompletedTask; }

        public Task SaveTestAsync(string id, DateTime at, bool ok, string message, CancellationToken ct)
        {
            var r = Rows.TryGetValue(id, out var x) ? x : new PlatformConnectionRow(id, null, null, null, null, null, null, null, null);
            Rows[id] = r with { LastTestAt = at, LastTestOk = ok, LastTestMessage = message };
            return Task.CompletedTask;
        }

        public Task<bool> HasBrokerAccountAsync(Guid userId, CancellationToken ct) => Task.FromResult(BrokerUsers.Contains(userId));
    }

    private sealed class FakeHandler : HttpMessageHandler
    {
        public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
        public string Body { get; set; } = "{}";
        public Exception? Throw { get; set; }
        public string? LastUrl { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastUrl = request.RequestUri?.ToString();
            if (Throw != null) throw Throw;
            return Task.FromResult(new HttpResponseMessage(Status) { Content = new StringContent(Body) });
        }
    }

    private sealed class FakeFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;
        public FakeFactory(HttpMessageHandler handler) => _handler = handler;
        public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false);
    }

    private sealed record Rig(PlatformConnectionsService Service, IConfigurationRoot Config, FakeStore Store, FakeHandler Handler);

    private static Rig NewRig(Dictionary<string, string?>? server = null, bool withStore = true)
    {
        var source = new PlatformSecretsConfigurationSource();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(server ?? new Dictionary<string, string?>())
            .Add(source) // última, como en Program.cs
            .Build();
        var store = new FakeStore();
        var handler = new FakeHandler();
        var service = new PlatformConnectionsService(config, source, withStore ? store : null, new FakeProtector(),
            new FakeFactory(handler), NullLogger<PlatformConnectionsService>.Instance);
        return new Rig(service, config, store, handler);
    }

    private static readonly Guid Admin = Guid.NewGuid();

    // ── tests ──────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_nunca_devuelve_el_valor_en_claro()
    {
        var rig = NewRig(new() { ["Bls:Key"] = "serverkey-9999-zzzz" });
        await rig.Service.SetKeyAsync("fred", FredKey, Admin, default);
        await rig.Service.SetKeyAsync("sec", "Gonzalo gonzalo@example.com", Admin, default);

        var list = await rig.Service.ListAsync(Admin, canEdit: true, default);
        var json = Newtonsoft.Json.JsonConvert.SerializeObject(list);

        Assert.DoesNotContain(FredKey, json);
        Assert.DoesNotContain("gonzalo@example.com", json);
        Assert.DoesNotContain("serverkey-9999-zzzz", json);
        Assert.Contains("••5678", json);
    }

    [Fact]
    public async Task Lista_estados_origen_y_catalogo()
    {
        var rig = NewRig(new() { ["Bls:Key"] = "serverkey-9999-zzzz" });
        await rig.Service.SetKeyAsync("fred", FredKey, Admin, default);

        var list = await rig.Service.ListAsync(Admin, true, default);
        ConnectionView Get(string id) => list.Connections.Single(c => c.Id == id);

        Assert.True(list.StorageReady);
        Assert.Equal("connected", Get("fred").Status);
        Assert.Equal("database", Get("fred").Origin);
        Assert.Equal("Admin Uno", Get("fred").UpdatedBy);
        Assert.Equal("connected", Get("bls").Status);
        Assert.Equal("server", Get("bls").Origin);
        Assert.Equal("••zzzz", Get("bls").Hint);
        Assert.Equal("missing", Get("sec").Status);
        Assert.Null(Get("sec").Origin);
        Assert.Equal("not-needed", Get("cboe").Status);
        Assert.Equal("not-needed", Get("bcra").Status);
        Assert.Equal("Argentina", Get("dolarapi").Group);
        Assert.Equal("local", Get("fmp").Status);
        Assert.Equal("missing", Get("tastytrade").Status);
        Assert.Equal(ConnectionCatalog.All.Count, list.Connections.Count);
    }

    [Fact]
    public async Task A3_es_editable_y_su_estado_considera_A3_ApiKey_y_A3_API_KEY()
    {
        var a3 = ConnectionCatalog.Find("a3")!;
        Assert.True(ConnectionCatalog.IsEditable(a3));
        Assert.Null(ConnectionCatalog.Find("mae"));

        var sin = (await NewRig().Service.ListAsync(Admin, true, default)).Connections.Single(c => c.Id == "a3");
        Assert.Equal("missing", sin.Status);
        Assert.Equal("Argentina", sin.Group);

        var env = (await NewRig(new() { ["A3_API_KEY"] = "env-key-12345678" }).Service.ListAsync(Admin, true, default)).Connections.Single(c => c.Id == "a3");
        Assert.Equal("connected", env.Status);
        Assert.Equal("server", env.Origin);

        var rig = NewRig();
        Assert.Equal(SetKeyOutcome.Ok, await rig.Service.SetKeyAsync("a3", "a3-secret-key-0001", Admin, default));
        var json = Newtonsoft.Json.JsonConvert.SerializeObject(await rig.Service.ListAsync(Admin, true, default));
        Assert.DoesNotContain("a3-secret-key-0001", json);
        Assert.Equal("a3-secret-key-0001", rig.Config["A3:ApiKey"]);
    }

    [Fact]
    public async Task Test_a3_manda_la_clave_en_header_y_el_mensaje_no_la_lleva()
    {
        var rig = NewRig();
        await rig.Service.SetKeyAsync("a3", "a3-secret-key-0001", Admin, default);
        var ok = await rig.Service.TestAsync("a3", default);
        Assert.True(ok!.Ok);
        Assert.Contains("api.mae.com.ar", rig.Handler.LastUrl);

        rig.Handler.Status = HttpStatusCode.Unauthorized;
        var bad = await rig.Service.TestAsync("a3", default);
        Assert.False(bad!.Ok);
        Assert.Contains("clave inválida", bad.Message);
        Assert.DoesNotContain("a3-secret-key-0001", bad.Message);
        Assert.DoesNotContain("http", bad.Message);
    }

    [Fact]
    public async Task Bls_opcional_sin_valor_queda_missing_y_aclara_limites_bajos()
    {
        var rig = NewRig();
        var bls = (await rig.Service.ListAsync(null, true, default)).Connections.Single(c => c.Id == "bls");
        Assert.Equal("missing", bls.Status);
        Assert.Contains("límites bajos", bls.Description);
    }

    [Fact]
    public async Task Tastytrade_conectada_si_el_usuario_tiene_cuenta()
    {
        var rig = NewRig();
        rig.Store.BrokerUsers.Add(Admin);
        var list = await rig.Service.ListAsync(Admin, true, default);
        Assert.Equal("connected", list.Connections.Single(c => c.Id == "tastytrade").Status);
    }

    [Fact]
    public async Task Base_gana_sobre_servidor_y_delete_vuelve_al_servidor()
    {
        var rig = NewRig(new() { ["FredApi:Key"] = "from-server-0000" });
        Assert.Equal("from-server-0000", rig.Config["FredApi:Key"]);

        Assert.Equal(SetKeyOutcome.Ok, await rig.Service.SetKeyAsync("fred", "  from-database-1111  ", Admin, default));
        Assert.Equal("from-database-1111", rig.Config["FredApi:Key"]); // trim + gana la base

        Assert.Equal(SetKeyOutcome.Ok, await rig.Service.DeleteKeyAsync("fred", Admin, default));
        Assert.Equal("from-server-0000", rig.Config["FredApi:Key"]);
        Assert.Empty(rig.Store.Rows);
    }

    [Fact]
    public async Task Load_carga_la_base_y_una_fila_que_no_descifra_no_tumba_nada()
    {
        var rig = NewRig(new() { ["Bls:Key"] = "server-bls-key" });
        rig.Store.Rows["fred"] = new PlatformConnectionRow("fred", "enc:" + FredKey, "••5678", DateTime.UtcNow, Admin, null, null, null, null);
        rig.Store.Rows["bls"] = new PlatformConnectionRow("bls", "basura-sin-prefijo", null, DateTime.UtcNow, Admin, null, null, null, null);

        await rig.Service.LoadAsync();

        Assert.Equal(FredKey, rig.Config["FredApi:Key"]);
        Assert.Equal("server-bls-key", rig.Config["Bls:Key"]);
    }

    [Fact]
    public async Task Sin_base_no_se_puede_guardar_y_la_lista_dice_por_que()
    {
        var rig = NewRig(withStore: false);
        Assert.Equal(SetKeyOutcome.StorageUnavailable, await rig.Service.SetKeyAsync("fred", FredKey, Admin, default));
        var list = await rig.Service.ListAsync(null, true, default);
        Assert.False(list.StorageReady);
        Assert.False(string.IsNullOrWhiteSpace(list.StorageMessage));
        await rig.Service.LoadAsync(); // no tira
    }

    [Theory]
    [InlineData("fred", "", SetKeyOutcome.Invalid)]
    [InlineData("fred", "   ", SetKeyOutcome.Invalid)]
    [InlineData("cboe", "x", SetKeyOutcome.NotEditable)]
    [InlineData("nope", "x", SetKeyOutcome.UnknownConnection)]
    public async Task Validaciones_del_put(string id, string value, SetKeyOutcome expected)
    {
        var rig = NewRig();
        Assert.Equal(expected, await rig.Service.SetKeyAsync(id, value, Admin, default));
    }

    [Fact]
    public async Task Put_con_mas_de_512_caracteres_es_invalido()
    {
        var rig = NewRig();
        Assert.Equal(SetKeyOutcome.Invalid, await rig.Service.SetKeyAsync("fred", new string('a', 513), Admin, default));
    }

    [Fact]
    public async Task Cambiar_la_clave_limpia_la_ultima_prueba()
    {
        var rig = NewRig();
        await rig.Service.SetKeyAsync("fred", FredKey, Admin, default);
        rig.Handler.Status = HttpStatusCode.BadRequest;
        await rig.Service.TestAsync("fred", default);
        Assert.Equal("error", (await rig.Service.ListAsync(Admin, true, default)).Connections.Single(c => c.Id == "fred").Status);

        await rig.Service.SetKeyAsync("fred", "otra-clave-12345", Admin, default);
        var fred = (await rig.Service.ListAsync(Admin, true, default)).Connections.Single(c => c.Id == "fred");
        Assert.Null(fred.LastTest);
        Assert.Equal("connected", fred.Status);
    }

    // ── permisos ───────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_y_delete_no_admin_es_403_y_sin_usuario_es_401()
    {
        Assert.Equal(WriteAccess.Forbidden, await ConnectionAccess.CheckWriteAsync(Guid.NewGuid(), _ => Task.FromResult(false)));
        Assert.Equal(WriteAccess.Unauthorized, await ConnectionAccess.CheckWriteAsync(null, _ => Task.FromResult(true)));
        Assert.Equal(WriteAccess.Allowed, await ConnectionAccess.CheckWriteAsync(Admin, _ => Task.FromResult(true)));
    }

    [Fact]
    public async Task CanEdit_sigue_la_regla_de_la_plataforma()
    {
        Assert.True(await ConnectionAccess.CanEditAsync(false, Guid.NewGuid(), _ => Task.FromResult(false)));
        Assert.True(await ConnectionAccess.CanEditAsync(true, null, _ => Task.FromResult(false)));
        Assert.False(await ConnectionAccess.CanEditAsync(true, Guid.NewGuid(), _ => Task.FromResult(false)));
        Assert.True(await ConnectionAccess.CanEditAsync(true, Admin, _ => Task.FromResult(true)));
    }

    // ── hint ───────────────────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("abcd1234", "••1234")]
    [InlineData("abcdefghij1a2b", "••1a2b")]
    [InlineData("abcdefg", null)]
    [InlineData("corto", null)]
    public void Hint_son_los_ultimos_4_solo_con_8_o_mas(string value, string? expected) =>
        Assert.Equal(expected, PlatformConnectionsService.Hint(value));

    // ── prueba de conexión ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Test_fred_ok_guarda_el_resultado_y_el_mensaje_no_lleva_la_clave_ni_la_url()
    {
        var rig = NewRig();
        await rig.Service.SetKeyAsync("fred", FredKey, Admin, default);

        var result = await rig.Service.TestAsync("fred", default);

        Assert.True(result!.Ok);
        Assert.DoesNotContain(FredKey, result.Message);
        Assert.DoesNotContain("http", result.Message);
        Assert.Contains("api_key=", rig.Handler.LastUrl); // la llamada real sí la lleva
        Assert.True(rig.Store.Rows["fred"].LastTestOk);
    }

    [Fact]
    public async Task Test_fred_400_dice_clave_invalida_sin_filtrarla()
    {
        var rig = NewRig();
        await rig.Service.SetKeyAsync("fred", FredKey, Admin, default);
        rig.Handler.Status = HttpStatusCode.BadRequest;
        rig.Handler.Body = $"{{\"error_message\":\"Bad key {FredKey}\"}}";

        var result = await rig.Service.TestAsync("fred", default);

        Assert.False(result!.Ok);
        Assert.Contains("400", result.Message);
        Assert.Contains("clave inválida", result.Message);
        Assert.DoesNotContain(FredKey, result.Message);
        Assert.False(rig.Store.Rows["fred"].LastTestOk);
    }

    [Fact]
    public async Task Test_con_excepcion_de_red_no_filtra_la_url_con_la_clave()
    {
        var rig = NewRig();
        await rig.Service.SetKeyAsync("fred", FredKey, Admin, default);
        rig.Handler.Throw = new HttpRequestException($"fallo en https://api.stlouisfed.org/fred/series?api_key={FredKey}");

        var result = await rig.Service.TestAsync("fred", default);

        Assert.False(result!.Ok);
        Assert.DoesNotContain(FredKey, result.Message);
        Assert.DoesNotContain("api_key", result.Message);
    }

    [Fact]
    public async Task Test_bls_lee_el_status_del_cuerpo()
    {
        var rig = NewRig();
        rig.Handler.Body = "{\"status\":\"REQUEST_NOT_PROCESSED\",\"message\":[\"daily threshold reached\"]}";
        var result = await rig.Service.TestAsync("bls", default);
        Assert.False(result!.Ok);
        Assert.Contains("daily threshold", result.Message);

        rig.Handler.Body = "{\"status\":\"REQUEST_SUCCEEDED\"}";
        Assert.True((await rig.Service.TestAsync("bls", default))!.Ok);
    }

    [Fact]
    public async Task Test_sec_sin_contacto_no_llama_y_con_403_lo_dice()
    {
        var rig = NewRig();
        var sin = await rig.Service.TestAsync("sec", default);
        Assert.False(sin!.Ok);
        Assert.Null(rig.Handler.LastUrl);

        await rig.Service.SetKeyAsync("sec", "Gonzalo gonzalo@example.com", Admin, default);
        rig.Handler.Status = HttpStatusCode.Forbidden;
        var result = await rig.Service.TestAsync("sec", default);
        Assert.False(result!.Ok);
        Assert.Contains("403", result.Message);
        Assert.DoesNotContain("gonzalo@example.com", result.Message);
    }

    [Fact]
    public async Task Test_de_id_desconocido_es_null_y_de_una_sin_clave_no_la_prueba()
    {
        var rig = NewRig();
        Assert.Null(await rig.Service.TestAsync("nope", default));
        var cboe = await rig.Service.TestAsync("cboe", default);
        Assert.False(cboe!.Ok);
        Assert.Null(rig.Handler.LastUrl);
    }

    [Fact]
    public void Sanitize_reemplaza_el_valor_por_puntos()
    {
        Assert.Equal("clave •••• mala", ConnectionTester.Sanitize($"clave {FredKey} mala", FredKey));
    }
}
