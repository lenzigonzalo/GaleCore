using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>
/// GC-0004 — métricas por versión de spec (AC-05) y el guard que impide persistir SHADOW fuera del
/// entorno local (AC-03).
/// </summary>
public class ShadowMetricsTests
{
    private static readonly DateTime T0 = new(2026, 9, 24, 14, 0, 0, DateTimeKind.Utc);

    private static ShadowPosition Closed(double pnl, int minutes) => new()
    {
        PositionId = Guid.NewGuid().ToString(), Status = "CLOSED", RealizedPnl = pnl, ExitAt = T0.AddMinutes(minutes),
    };

    private static ShadowPosition Open(double? unrealized) => new()
    {
        PositionId = Guid.NewGuid().ToString(), Status = "OPEN", UnrealizedPnl = unrealized,
    };

    [Fact]
    public void WithoutTrades_WhatDoesNotExistIsNull_NotZero()
    {
        var m = ShadowMetrics.Compute(new SpecVersionRecord
        {
            ContentHash = "sha256:x", Evaluations = 42, EvaluationsPassed = 0,
            EventCounts = new() { ["GATES_NOT_PASSED"] = 40, ["METRICS_NO_DATA"] = 2, ["EVALUATION_COMPLETED"] = 42 },
        });

        Assert.True(m.NoTrades);
        Assert.Equal(0, m.PositionsOpened);
        Assert.Null(m.RealizedPnl);
        Assert.Null(m.UnrealizedPnl);
        Assert.Null(m.WinRate);
        Assert.Null(m.MaxDrawdown);
        Assert.Equal(new Dictionary<string, int> { ["GATES_NOT_PASSED"] = 40 }, m.Discards);
        Assert.Equal(40, m.DiscardsTotal);
        Assert.Equal(2, m.NoDataBlocks);
        Assert.Equal(42, m.Evaluations);
    }

    [Fact]
    public void ClosedTrades_RealizedWinRateAndDrawdown_InExitOrder()
    {
        // Acumulado en orden de salida: +50, −30 (20), −40 (−20), +100 (80). Máximo 50 → mínimo −20 = 70.
        var m = ShadowMetrics.Compute(new SpecVersionRecord
        {
            Positions = new() { Closed(100, 40), Closed(50, 10), Closed(-40, 30), Closed(-30, 20) },
        });

        Assert.False(m.NoTrades);
        Assert.Equal(4, m.PositionsClosed);
        Assert.Equal(80, m.RealizedPnl);
        Assert.Equal(0.5, m.WinRate);
        Assert.Equal(70, m.MaxDrawdown);
    }

    [Fact]
    public void SimultaneousExits_CountAsOneStep_WhateverTheRowOrder()
    {
        // Dos salidas en el mismo tick (+100 y −100) no generan un drawdown que dependa del orden.
        var a = ShadowMetrics.Compute(new SpecVersionRecord { Positions = new() { Closed(100, 10), Closed(-100, 10) } });
        var b = ShadowMetrics.Compute(new SpecVersionRecord { Positions = new() { Closed(-100, 10), Closed(100, 10) } });
        Assert.Equal(0, a.MaxDrawdown);
        Assert.Equal(a.MaxDrawdown, b.MaxDrawdown);
    }

    [Fact]
    public void Drawdown_FromTheStart_CountsAFirstLoss()
    {
        Assert.Equal(30, ShadowMetrics.MaxDrawdown(new[] { -30.0, 10.0 }));
        Assert.Equal(0, ShadowMetrics.MaxDrawdown(new[] { 10.0, 20.0 }));
    }

    [Fact]
    public void OpenPositions_OnlyValuedOnesCountInUnrealized()
    {
        var m = ShadowMetrics.Compute(new SpecVersionRecord { Positions = new() { Open(25), Open(-10), Open(null) } });

        Assert.Equal(3, m.PositionsOpen);
        Assert.Equal(1, m.OpenPositionsNotValued);
        Assert.Equal(15, m.UnrealizedPnl);
        Assert.Null(m.RealizedPnl);
    }

    [Fact]
    public void OnlyUnvaluedOpenPositions_UnrealizedIsNull()
    {
        var m = ShadowMetrics.Compute(new SpecVersionRecord { Positions = new() { Open(null) } });
        Assert.Null(m.UnrealizedPnl);
        Assert.Equal(1, m.OpenPositionsNotValued);
    }

    // ── AC-03: persiste sólo donde el entorno lo prende ───────────

    [Fact]
    public void PersistenceOff_IsRejected_EvenWithADatabase()
    {
        var reason = ShadowPersistenceGuard.RejectReason(false, "Host=db.example.supabase.co;Database=postgres");
        Assert.NotNull(reason);
        Assert.Contains(ShadowPersistenceGuard.EnabledKey, reason);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void PersistenceOn_WithoutDatabase_IsRejected(string? cs) => Assert.NotNull(ShadowPersistenceGuard.RejectReason(true, cs));

    [Fact]
    public void PersistenceOn_WithDatabase_IsAccepted()
        => Assert.Null(ShadowPersistenceGuard.RejectReason(true, "Host=aws-1-sa-east-1.pooler.supabase.com;Database=postgres"));

    [Fact]
    public void PersistenceIsOffByDefault_InTheCommittedConfig()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "DataFeed.Api", "appsettings.json"))) dir = dir.Parent;
        var json = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(dir!.FullName, "DataFeed.Api", "appsettings.json")));
        Assert.False(json.RootElement.GetProperty("Runtime").GetProperty("Persistence").GetProperty("Enabled").GetBoolean());
    }
}
