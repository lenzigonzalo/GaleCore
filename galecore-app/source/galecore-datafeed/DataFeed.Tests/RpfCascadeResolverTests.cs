using DataFeed.Application.App.Rpf.Engine;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Congela el cortocircuito de la SEÑAL del motor RPF (RpfCascadeResolver): qué capa reporta el corte
/// (FailedAtLayer) y qué veredicto propaga (OverallSignal). El cupo/sizing NO participa — es ortogonal a
/// la validez de la señal (lo lee la máquina de estados). Orden: macro(1) → strike(2) → micro(3) → gates(2).
/// </summary>
public class RpfCascadeResolverTests
{
    [Fact]
    public void MacroNoOpera_CortaEnCapa1()
    {
        var (overall, failed) = RpfCascadeResolver.Resolve("NO_OPERAR", "OPERAR", "OPERAR", true);
        Assert.Equal("NO_OPERAR", overall);
        Assert.Equal(1, failed);
    }

    [Fact]
    public void MacroEspera_SePropagaComoVeredictoPeroNoFrena()
    {
        // ESPERAR (macro 5/6) no corta en capa 1; si strike falla, corta en 2 propagando ESPERAR.
        var (overall, failed) = RpfCascadeResolver.Resolve("ESPERAR", "NO_OPERAR", "OPERAR", false);
        Assert.Equal("ESPERAR", overall);
        Assert.Equal(2, failed);
    }

    [Fact]
    public void MacroOpera_StrikeFalla_CortaEnCapa2NoOpera()
    {
        var (overall, failed) = RpfCascadeResolver.Resolve("OPERAR", "NO_OPERAR", "OPERAR", false);
        Assert.Equal("NO_OPERAR", overall);
        Assert.Equal(2, failed);
    }

    [Fact]
    public void MicroFalla_CortaEnCapa3()
    {
        var (_, failed) = RpfCascadeResolver.Resolve("OPERAR", "OPERAR", "NO_OPERAR", false);
        Assert.Equal(3, failed);
    }

    [Fact]
    public void TodoPasa_GatesFallan_CortaEnCapa2()
    {
        // Los signal_gates son parte del embudo del strike-engine → capa 2.
        var (overall, failed) = RpfCascadeResolver.Resolve("OPERAR", "OPERAR", "OPERAR", gatesAllPass: false);
        Assert.Equal("NO_OPERAR", overall);
        Assert.Equal(2, failed);
    }

    [Fact]
    public void TodoPasa_GatesPasan_Opera()
    {
        var (overall, failed) = RpfCascadeResolver.Resolve("OPERAR", "OPERAR", "OPERAR", gatesAllPass: true);
        Assert.Equal("OPERAR", overall);
        Assert.Null(failed);
    }

    [Fact]
    public void TodoPasa_GatesPasan_ConMacroEspera_PropagaEspera()
    {
        // Macro ESPERAR que llega hasta el final con gates OK: el veredicto es ESPERAR, sin capa de corte.
        var (overall, failed) = RpfCascadeResolver.Resolve("ESPERAR", "OPERAR", "OPERAR", gatesAllPass: true);
        Assert.Equal("ESPERAR", overall);
        Assert.Null(failed);
    }

    [Fact]
    public void ElCupoNoParticipa_SoloMacroStrikeMicroGates()
    {
        // No hay parámetro de sizing: con macro+strike+micro OK y gates OK, la señal es OPERAR
        // aunque el libro esté lleno (eso lo resuelve la máquina de estados vía CapacityAvailable).
        var (overall, failed) = RpfCascadeResolver.Resolve("OPERAR", "OPERAR", "OPERAR", gatesAllPass: true);
        Assert.Equal("OPERAR", overall);
        Assert.Null(failed);
    }
}
