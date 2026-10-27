using DataFeed.Application.App.Shared;

namespace DataFeed.Tests;

/// <summary>
/// Congela la tabla de verdad del switch de estrategia, que tiene dos niveles (reglas y plataforma).
/// Es una función pura a propósito: la regla que decide si una estrategia opera se puede verificar
/// sin base, sin disco y sin levantar la API.
///
/// Lo que estos tests protegen no es la aritmética booleana sino DOS invariantes:
///   * el nivel de plataforma manda cuando está presente — es el kill switch del operador, y tiene
///     que poder apagar una estrategia que su JSON declara prendida;
///   * el nivel ausente HEREDA del de arriba, nunca prende por su cuenta.
/// </summary>
public class StrategyEnablementTests
{
    [Fact]
    public void Sin_override_manda_el_json_de_reglas()
    {
        Assert.Equal((true, "rules"), StrategyEnablement.Resolve(rules: true, platform: null));
        Assert.Equal((false, "rules"), StrategyEnablement.Resolve(rules: false, platform: null));
    }

    /// <summary>
    /// El invariante del kill switch: el operador tiene que poder cortar el consumo de feed y la
    /// emisión de una estrategia sin editar su JSON ni reiniciar la API. Si esto se rompe, pierde
    /// la única palanca que apaga en el acto.
    /// </summary>
    [Fact]
    public void El_override_de_plataforma_pisa_al_json_de_reglas()
    {
        Assert.Equal((false, "platform"), StrategyEnablement.Resolve(rules: true, platform: false));
        Assert.Equal((true, "platform"), StrategyEnablement.Resolve(rules: false, platform: true));
    }

    /// <summary>
    /// Con las reglas en OFF y sin override, la estrategia está apagada: el nivel ausente hereda,
    /// no prende.
    /// </summary>
    [Fact]
    public void El_nivel_ausente_hereda_en_vez_de_prender()
    {
        var (enabled, source) = StrategyEnablement.Resolve(rules: false, platform: null);

        Assert.False(enabled);
        Assert.Equal("rules", source);
    }

    /// <summary>
    /// El switch es GLOBAL desde el 2026-08-12: no hay tercer nivel por usuario. Este test es el
    /// recordatorio ejecutable de que `Resolve` toma dos argumentos y de que su resultado no
    /// depende de quién pregunta — si alguien vuelve a sumar un nivel, que sea una decisión y no
    /// un descuido. Ver docs/GaleCore-plan-reorganizacion-2026-08.md.
    /// </summary>
    [Fact]
    public void El_resultado_no_depende_de_quien_pregunta()
    {
        var primera = StrategyEnablement.Resolve(rules: true, platform: null);
        var segunda = StrategyEnablement.Resolve(rules: true, platform: null);

        Assert.Equal(primera, segunda);
        Assert.Equal(2, typeof(StrategyEnablement)
            .GetMethod(nameof(StrategyEnablement.Resolve))!
            .GetParameters().Length);
    }
}
