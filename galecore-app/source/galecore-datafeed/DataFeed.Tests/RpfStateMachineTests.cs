using DataFeed.Application.App.Rpf;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Fase 6a: máquina de estados RPF (función pura, diseño Fase 5 §4).
/// Congela la precedencia y, sobre todo, las dos decisiones del operador (2026-07-29) que la
/// hacen compatible con la cartera V2: IN_POSITION = libro lleno SIN trigger vivo (no "cualquier
/// posición abierta"), y VETOED gana sobre IN_POSITION (safety-first).
/// </summary>
public class RpfStateMachineTests
{
    // Base: Tier A pasa, edge cruza, hay cupo, sin cooldown, sin posición → TRIGGERED.
    private static RpfStateInputs Firing() => new()
    {
        HasOpenPosition = false,
        TailScore = 0,
        TailScoreAvailable = true,
        TierAPass = true,
        EdgePass = true,
        CapacityAvailable = true,
        InCooldown = false,
    };

    [Fact]
    public void Triggered_CuandoTodoAlinea()
        => Assert.Equal(RpfState.Triggered, RpfStateMachine.Evaluate(Firing()));

    // ── V2: el segundo cupo (lo que la lectura literal de la tabla §8 rompía) ──

    [Fact]
    public void V2_ConUnaPosicionAbiertaYCupoLibre_SigueArmandoParaLaSegunda()
    {
        // 1 de 2 cupos ocupados: el sistema NO queda mudo en IN_POSITION — sigue vigilando el edge.
        var inp = Firing() with { HasOpenPosition = true, EdgePass = false };
        Assert.Equal(RpfState.Armed, RpfStateMachine.Evaluate(inp));
    }

    [Fact]
    public void V2_ConUnaPosicionAbiertaYCupoLibre_PuedeDispararLaSegunda()
    {
        var inp = Firing() with { HasOpenPosition = true };
        Assert.Equal(RpfState.Triggered, RpfStateMachine.Evaluate(inp));
    }

    [Fact]
    public void InPosition_SoloConLibroLlenoYSinTriggerVivo()
    {
        var inp = Firing() with { HasOpenPosition = true, CapacityAvailable = false, EdgePass = false };
        Assert.Equal(RpfState.InPosition, RpfStateMachine.Evaluate(inp));
    }

    [Fact]
    public void InPosition_TambienSiElEntornoSeCierraConElLibroLleno()
    {
        // Tier A cae (ej. VRP < 1.2) con las 2 posiciones abiertas: solo queda gestionar.
        var inp = Firing() with { HasOpenPosition = true, CapacityAvailable = false, TierAPass = false, EdgePass = false };
        Assert.Equal(RpfState.InPosition, RpfStateMachine.Evaluate(inp));
    }

    [Fact]
    public void WaitingCapacity_GanaSobreInPosition_CuandoElEdgeCruzaConElLibroLleno()
    {
        // El caso que justifica el estado (§8): 2 de 2 ocupados y aparece un trade que cruza la barra.
        var inp = Firing() with { HasOpenPosition = true, CapacityAvailable = false };
        Assert.Equal(RpfState.WaitingCapacity, RpfStateMachine.Evaluate(inp));
    }

    // ── Post-reordenamiento: cupo desacoplado de los gates ──
    // Los gates (seguridad + dispara) ahora corren independientes del sizing, así que la cascada YA PUEDE
    // emitir (!capacity ∧ tierA ∧ edge) — WAITING_CAPACITY pasa de inalcanzable a alcanzable. Y como el
    // tail se evalúa siempre, el veto de cola es autoridad global (se afirma aun con el macro caído).

    [Fact]
    public void WaitingCapacity_AlcanzableConCupoDesacoplado()
    {
        // Candidato válido + edge cruza + libro lleno: la señal existe pero no hay dónde abrirla.
        // Antes era inalcanzable (el sizing cortaba antes de los gates); ahora la cascada lo emite.
        var inp = Firing() with { HasOpenPosition = true, CapacityAvailable = false };
        Assert.Equal(RpfState.WaitingCapacity, RpfStateMachine.Evaluate(inp));
    }

    [Fact]
    public void Vetoed_Global_AunConMacroCaidoYLibroLleno()
    {
        // El tail corre siempre → el veto es autoridad global: se afirma aunque el entorno macro no
        // habilite (TierAPass=false) y el libro esté lleno (CapacityAvailable=false).
        var inp = Firing() with
        {
            TailScore = 3, TailScoreAvailable = true,
            TierAPass = false, EdgePass = false,
            CapacityAvailable = false, HasOpenPosition = true,
        };
        Assert.Equal(RpfState.Vetoed, RpfStateMachine.Evaluate(inp));
    }

    [Fact]
    public void SinCupoPorHeat_SinPosiciones_NoEsInPosition()
    {
        // Cupo bloqueado por heat cap sin posiciones abiertas: no hay nada que gestionar.
        var inp = Firing() with { HasOpenPosition = false, CapacityAvailable = false, EdgePass = false };
        Assert.Equal(RpfState.Dormant, RpfStateMachine.Evaluate(inp));
    }

    // ── Veto de cola: autoridad ──

    [Fact]
    public void Vetoed_CuandoTailScoreAltoYCorrio()
    {
        var inp = Firing() with { TailScore = 2, TierAPass = false };
        Assert.Equal(RpfState.Vetoed, RpfStateMachine.Evaluate(inp));
    }

    [Fact]
    public void Vetoed_GanaSobreInPosition()
    {
        // Decisión del operador: el peligro activo domina la lectura aunque haya posiciones abiertas.
        var inp = Firing() with
        {
            TailScore = 2,
            TierAPass = false,
            EdgePass = false,
            HasOpenPosition = true,
            CapacityAvailable = false,
        };
        Assert.Equal(RpfState.Vetoed, RpfStateMachine.Evaluate(inp));
    }

    [Fact]
    public void Vetoed_GanaSobreWaitingCapacity()
    {
        var inp = Firing() with { TailScore = 3, HasOpenPosition = true, CapacityAvailable = false };
        Assert.Equal(RpfState.Vetoed, RpfStateMachine.Evaluate(inp));
    }

    [Fact]
    public void Dormant_SiTailNoTieneDatos_AunqueTierAFalle()
    {
        // Guarda defensiva: si el tail NO tiene datos (VVIX y skew ausentes — raro post-reordenamiento,
        // donde el tail se evalúa siempre) no se puede afirmar VETOED → DORMANT honesto.
        var inp = Firing() with { TailScoreAvailable = false, TailScore = 0, TierAPass = false };
        Assert.Equal(RpfState.Dormant, RpfStateMachine.Evaluate(inp));
    }

    // ── Resto de la cascada ──

    [Fact]
    public void Dormant_CuandoTierAFallaSinVeto()
    {
        // Ej: VRP < 1.2 o GEX < 0 — entorno no habilita, pero sin peligro de cola.
        var inp = Firing() with { TierAPass = false };
        Assert.Equal(RpfState.Dormant, RpfStateMachine.Evaluate(inp));
    }

    [Fact]
    public void Armed_CuandoTierAPasaPeroEdgeNoCruza()
    {
        var inp = Firing() with { EdgePass = false };
        Assert.Equal(RpfState.Armed, RpfStateMachine.Evaluate(inp));
    }

    [Fact]
    public void Cooldown_CuandoEdgeCruzaYHayCupoPeroEnCooldown()
    {
        var inp = Firing() with { InCooldown = true };
        Assert.Equal(RpfState.Cooldown, RpfStateMachine.Evaluate(inp));
    }

    [Fact]
    public void Cooldown_NoAplicaSiElEdgeNoCruza()
    {
        // El cooldown suprime el re-disparo; sin edge el estado sigue siendo ARMED.
        var inp = Firing() with { InCooldown = true, EdgePass = false };
        Assert.Equal(RpfState.Armed, RpfStateMachine.Evaluate(inp));
    }

    [Theory]
    [InlineData(RpfState.InPosition, "IN_POSITION")]
    [InlineData(RpfState.Vetoed, "VETOED")]
    [InlineData(RpfState.Dormant, "DORMANT")]
    [InlineData(RpfState.Armed, "ARMED")]
    [InlineData(RpfState.WaitingCapacity, "WAITING_CAPACITY")]
    [InlineData(RpfState.Cooldown, "COOLDOWN")]
    [InlineData(RpfState.Triggered, "TRIGGERED")]
    public void ToWire_EspejaLosNombresDelJson(RpfState state, string wire)
        => Assert.Equal(wire, state.ToWire());
}
