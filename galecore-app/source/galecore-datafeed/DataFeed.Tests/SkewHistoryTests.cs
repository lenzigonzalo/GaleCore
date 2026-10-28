using DataFeed.Application.App.SignalGates;

namespace DataFeed.Tests;

/// <summary>
/// Congela las dos defensas que se le agregaron a la lectura de skew25_history.json tras auditarla
/// el 2026-08-25. Las dos salen de defectos que la serie tuvo de verdad, no de casos imaginados.
/// </summary>
public class SkewHistoryTests
{
    /// <summary>
    /// El caso real: el servicio fechaba en UTC y no miraba el calendario, así que quedó un punto
    /// el domingo 2026-08-23 y otro el lunes 24 con el MISMO valor. Como el conteo de sesiones es
    /// posicional, ese punto de más corría la ventana del RoC un lugar.
    /// </summary>
    [Fact]
    public void ElPuntoDeFinDeSemanaNoCuentaComoSesion()
    {
        var h = SkewHistory.Parse("""
        { "SPY": [
            { "date": "2026-08-19", "skew25": 1.10, "dte": 30 },
            { "date": "2026-08-20", "skew25": 1.11, "dte": 30 },
            { "date": "2026-08-21", "skew25": 1.12, "dte": 30 },
            { "date": "2026-08-23", "skew25": 1.99, "dte": 30 },
            { "date": "2026-08-24", "skew25": 1.13, "dte": 30 },
            { "date": "2026-08-25", "skew25": 1.14, "dte": 30 }
        ] }
        """);

        // Con el domingo dentro serían 6 puntos y "hace 5 sesiones" caería en el 20 (1.11).
        // Filtrado, son 5 y cae en el 19 (1.10).
        Assert.Equal(1.10, h.ValueSessionsAgo("SPY", 5));
        Assert.DoesNotContain(1.99, new[] { h.ValueSessionsAgo("SPY", 1), h.ValueSessionsAgo("SPY", 2),
                                            h.ValueSessionsAgo("SPY", 3), h.ValueSessionsAgo("SPY", 4),
                                            h.ValueSessionsAgo("SPY", 5) });
    }

    private static SkewHistory Cinco(int dte) => SkewHistory.Parse($$"""
    { "SPY": [
        { "date": "2026-08-18", "skew25": 1.00, "dte": {{dte}} },
        { "date": "2026-08-19", "skew25": 1.01, "dte": {{dte}} },
        { "date": "2026-08-20", "skew25": 1.02, "dte": {{dte}} },
        { "date": "2026-08-21", "skew25": 1.03, "dte": {{dte}} },
        { "date": "2026-08-24", "skew25": 1.04, "dte": {{dte}} }
    ] }
    """);

    [Fact]
    public void ConPlazosComparables_CalculaElRoC()
    {
        double? roc = Cinco(30).Roc5d("SPY", 1.10, currentDte: 31);

        Assert.NotNull(roc);
        Assert.Equal(1.10 / 1.00 - 1.0, roc!.Value, 6);
    }

    /// <summary>
    /// El caso del 2026-08-18: la serie pasó de medir 2026-09-18 (DTE 35) a 2026-10-16 (DTE 59) y
    /// el skew saltó +0.038 en SPY y +0.034 en QQQ el mismo día. Ese escalón es el cambio de plazo,
    /// no la cola, y no tiene por qué entrar al RoC.
    /// </summary>
    [Fact]
    public void ConPlazosDistintos_ElRoCSeAnula()
    {
        Assert.Null(Cinco(35).Roc5d("SPY", 1.10, currentDte: 59));
    }

    [Fact]
    public void EnElBordeDeLaTolerancia_TodaviaCalcula()
    {
        Assert.NotNull(Cinco(30).Roc5d("SPY", 1.10, currentDte: 30 + SkewHistory.DteToleranceDays));
        Assert.Null(Cinco(30).Roc5d("SPY", 1.10, currentDte: 30 + SkewHistory.DteToleranceDays + 1));
    }

    /// <summary>
    /// Los puntos anteriores al 2026-08-25 no llevan <c>dte</c>. Frente a uno de esos no se puede
    /// saber si los plazos son comparables, así que el RoC devuelve null y el gate degrada a "sin
    /// dato" — que es lo correcto, y se cura solo cuando la serie acumula cinco puntos nuevos.
    /// </summary>
    [Fact]
    public void ConHistoriaViejaSinDte_ElRoCSeAnula()
    {
        var vieja = SkewHistory.Parse("""
        { "SPY": [
            { "date": "2026-08-18", "skew25": 1.00 },
            { "date": "2026-08-19", "skew25": 1.01 },
            { "date": "2026-08-20", "skew25": 1.02 },
            { "date": "2026-08-21", "skew25": 1.03 },
            { "date": "2026-08-24", "skew25": 1.04 }
        ] }
        """);

        Assert.Null(vieja.Roc5d("SPY", 1.10, currentDte: 30));
        // Sin DTE vivo no hay guarda que aplicar, y el comportamiento histórico se mantiene.
        Assert.NotNull(vieja.Roc5d("SPY", 1.10));
    }

    [Fact]
    public void UnaFechaIlegibleSeDescarta()
    {
        var h = SkewHistory.Parse("""
        { "SPY": [ { "date": "ayer", "skew25": 1.00 }, { "date": "2026-08-24", "skew25": 1.04 } ] }
        """);

        Assert.Equal(1.04, h.ValueSessionsAgo("SPY", 1));
        Assert.Null(h.ValueSessionsAgo("SPY", 2));
    }
}
