using DataFeed.Application.App.Market;
using Xunit;

namespace DataFeed.Tests;

public class ChatSuggestionsTests
{
    private static readonly DateOnly Today = new(2026, 10, 16);
    private static SuggestionQuote Q(string s, double pct, DateOnly? session = null) =>
        new(s, s, pct, session ?? Today, new double[] { 1, 2, 3 });

    [Fact]
    public void Lo_que_pasa_el_umbral_y_la_Fed_van_primero_y_se_completa_hasta_cuatro()
    {
        var quotes = new[] { Q("SPY", -1.24), Q("QQQ", -0.4), Q("IWM", 0.1), Q("TLT", 0.2), Q("VIX", 8.5) };
        var events = new[] { new SuggestionEvent(Today.AddDays(1), "FOMC"), new SuggestionEvent(Today.AddDays(5), "Inflación (IPC)") };
        var r = ChatSuggestionsRules.Build(quotes, events, Today);
        Assert.Equal(4, r.Count);
        Assert.Equal(new[] { "move-VIX", "move-SPY", "event-20261017-FOMC", "move-QQQ" }, r.Select(i => i.Id));
        var spy = r.Single(i => i.Id == "move-SPY");
        Assert.Equal("−1,24 %", spy.Value);
        Assert.Equal("down", spy.Tone);
        Assert.Contains("entender qué está pasando", spy.Question);
        Assert.Equal("down", r.Single(i => i.Id == "move-VIX").Tone);
        Assert.Equal("Mañana", r.Single(i => i.Kind == "event").Value);
    }

    [Fact]
    public void Con_mercado_cerrado_dice_de_que_cierre_es_y_sin_datos_no_inventa()
    {
        var r = ChatSuggestionsRules.Build(new[] { Q("SPY", 1.5, Today.AddDays(-1)) }, Array.Empty<SuggestionEvent>(), Today);
        Assert.Equal("cierre del 15/10", r.Single().AsOf);
        Assert.Contains("última rueda", r.Single().Question);
        Assert.Empty(ChatSuggestionsRules.Build(Array.Empty<SuggestionQuote>(), Array.Empty<SuggestionEvent>(), Today));
    }
}
