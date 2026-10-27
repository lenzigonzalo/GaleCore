using System.Text.Json;
using System.Text.Json.Serialization;
using DataFeed.Application.Shared;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Congela el saneo de no-finitos que usan los tools MCP.
///
/// Contexto (2026-08-10): los tools MCP de market data fallaban para CUALQUIER símbolo con datos
/// reales. dxFeed manda NaN en los campos que no aplican al instrumento — un índice como VIX no tiene
/// Size ni DayVolume — el DTO los declara double no nullable, y System.Text.Json se niega a escribir
/// NaN porque no es JSON válido.
///
/// Lo que más importa fijar es que el resultado sea null y NO cero: un cero se leería como "el
/// volumen fue cero", que es una afirmación falsa distinta de "no aplica".
/// </summary>
public class NonFiniteDoubleConverterTests
{
    private sealed class Muestra
    {
        public double Valor { get; set; }
        public double? Opcional { get; set; }
    }

    private static readonly JsonSerializerOptions Opts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new NonFiniteDoubleConverter() },
    };

    /// <summary>Parsea en vez de hacer string-matching: comparar contra el texto crudo depende del
    /// espaciado y de WriteIndented, y una aserción frágil que falla por formato no dice nada del
    /// comportamiento que se quiere fijar.</summary>
    private static JsonElement Campo(Muestra m, string nombre)
        => JsonDocument.Parse(JsonSerializer.Serialize(m, Opts)).RootElement.GetProperty(nombre);

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void NoFinito_SerializaComoNull(double v)
    {
        Assert.Equal(JsonValueKind.Null, Campo(new Muestra { Valor = v }, "valor").ValueKind);
    }

    [Fact]
    public void NoFinito_NoSerializaComoCero()
    {
        // La distinción que importa: null es "no aplica"; 0 sería "el valor fue cero", que es una
        // afirmación distinta y falsa. Mismo criterio que el expected move del 0DTE.
        var campo = Campo(new Muestra { Valor = double.NaN }, "valor");
        Assert.NotEqual(JsonValueKind.Number, campo.ValueKind);
    }

    [Fact]
    public void Finito_SerializaNormal()
    {
        var campo = Campo(new Muestra { Valor = 15.43 }, "valor");
        Assert.Equal(JsonValueKind.Number, campo.ValueKind);
        Assert.Equal(15.43, campo.GetDouble());
    }

    [Fact]
    public void Cero_SigueSiendoCero()
    {
        // Guarda contra sanear de más: 0 es finito y es un valor legítimo.
        var campo = Campo(new Muestra { Valor = 0 }, "valor");
        Assert.Equal(JsonValueKind.Number, campo.ValueKind);
        Assert.Equal(0, campo.GetDouble());
    }

    [Fact]
    public void Nullable_TambienQuedaCubierto()
    {
        // System.Text.Json aplica un converter de double también a double?: desenvuelve y delega.
        // Si eso dejara de valer, el síntoma sería una excepción en runtime; este test lo agarra antes.
        Assert.Equal(JsonValueKind.Null, Campo(new Muestra { Opcional = double.NaN }, "opcional").ValueKind);
    }

    [Fact]
    public void ObjetoCompleto_NoTira()
    {
        // El caso real: un TradeEvent de índice con precio bueno y volumen NaN. Antes de esto,
        // serializar esto era una excepción y el tool MCP devolvía "An error occurred".
        var m = new Muestra { Valor = double.NaN, Opcional = 15.43 };
        var ex = Record.Exception(() => JsonSerializer.Serialize(m, Opts));
        Assert.Null(ex);
    }
}
