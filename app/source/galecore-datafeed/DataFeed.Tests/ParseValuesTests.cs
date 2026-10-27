using DataFeed.Application.Shared;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// WS-0053: DXLink manda el volumen de las acciones fraccionario ("35789467.212652") y ParseLong lo
/// devolvía como 0, así que todas las velas de acciones salían sin volumen.
/// </summary>
public class ParseValuesTests
{
    [Theory]
    [InlineData("35789467.212652", 35789467L)]
    [InlineData("1234.5", 1235L)]
    [InlineData("1.2E7", 12000000L)]
    [InlineData("42", 42L)]
    public void ParseLong_acepta_volumen_fraccionario_y_lo_redondea(string input, long esperado)
        => Assert.Equal(esperado, ParseValues.ParseLong(input));

    [Theory]
    [InlineData("NaN")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("Infinity")]
    public void ParseLong_sin_dato_sigue_en_cero(string? input)
        => Assert.Equal(0L, ParseValues.ParseLong(input!));
}
