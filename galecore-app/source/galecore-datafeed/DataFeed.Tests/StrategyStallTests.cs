using DataFeed.Application.App.Runtime;
using DataFeed.Application.App.Runtime.Contracts;

namespace DataFeed.Tests;

/// <summary>WS-0098 — «por qué no opera»: un solo cálculo, sólo bloqueos de límites y candidatos inviables.</summary>
public class StrategyStallTests
{
    private static OperationalEvent Ev(string type, int day, Dictionary<string, object?>? payload = null) => new()
    {
        EventId = $"{type}{day}", InstanceId = "i1", EventType = type,
        Timestamp = new DateTime(2026, 11, day, 18, 45, 0, DateTimeKind.Utc), Payload = payload ?? new(),
    };

    private static OperationalEvent Bet(int day) => Ev("ENTRY_SKIPPED", day, new()
    {
        ["limit"] = "max_bet", ["reason"] = "tope por apuesta: abierto 0.00 + nueva 200.00 USD supera el tope de 9.00 USD",
    });

    private static OperationalEvent Gate(int day) => Ev("GATES_NOT_PASSED", day);

    [Fact]
    public void Sandwich_130_History_Is_Four_Days_Stopped_By_The_Bet_Cap_Across_The_Gate_Days()
    {
        // 3 y 4/11 tope por apuesta; 5 y 6/11 sólo el gate del VIX; 9 y 10/11 tope por apuesta.
        var stall = StrategyStall.Compute(new[] { Bet(3), Bet(4), Gate(5), Gate(6), Bet(9), Bet(10) });
        Assert.NotNull(stall);
        Assert.Equal(4, stall!.Days);
        Assert.Equal("2026-11-03", stall.Since);
        Assert.Equal("ENTRY_SKIPPED:max_bet", stall.Cause);
        Assert.Equal("4 días hábiles seguidos sin entrar por tope por apuesta", stall.Text);
        Assert.Contains("9.00 USD", stall.Reason);
    }

    [Fact]
    public void Gates_Alone_Never_Count()
    {
        Assert.Null(StrategyStall.Compute(new[] { Gate(3), Gate(4), Gate(5) }));
    }

    [Fact]
    public void An_Opened_Position_Ends_The_Streak()
    {
        Assert.Null(StrategyStall.Compute(new[] { Bet(3), Bet(4), Ev("POSITION_OPENED", 5) }));
        var after = StrategyStall.Compute(new[] { Bet(3), Ev("POSITION_OPENED", 4), Bet(5), Bet(6) });
        Assert.Equal(2, after!.Days);
    }

    [Fact]
    public void Another_Candidate_Level_Cause_Cuts_The_Streak()
    {
        var inviable = Ev("CANDIDATE_NOT_VIABLE", 6, new() { ["reason"] = "crédito 2 menor al mínimo 2.5" });
        var stall = StrategyStall.Compute(new[] { Bet(3), Bet(4), inviable, Bet(9), Bet(10) });
        Assert.Equal(2, stall!.Days);
    }

    [Fact]
    public void One_Day_Reads_In_Singular_And_No_Events_Is_Null()
    {
        Assert.Equal("1 día hábil sin entrar por tope por apuesta", StrategyStall.Compute(new[] { Bet(3) })!.Text);
        Assert.Null(StrategyStall.Compute(Array.Empty<OperationalEvent>()));
    }
}
