using DataFeed.Application.App.Shared;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Congela el check vix_term_structure (CascadeUtils.EvaluateVixTermStructure).
///
/// Existe porque este check estuvo midiendo tres cosas distintas a la vez hasta 2026-08-10: el JSON
/// de RPF declaraba el cierre del VIX de hace 9 días contra el de hace 30 (una tendencia), el de GEX
/// declaraba la IV del propio símbolo a 9d y 30d (una curva, pero del símbolo), y el código
/// implementaba la segunda. Nada lo confrontaba.
///
/// Lo que más importa acá es la política de sin-dato: el check NO bloquea cuando falta el índice,
/// pero tampoco puede reportarse como un pass legítimo. Esa distinción es invisible salvo que se
/// fije.
/// </summary>
public class VixTermStructureTests
{
    [Fact]
    public void Contango_Pasa()
    {
        // VIX9D por debajo del VIX de 30d: curva normal, el entorno no está estresado.
        var r = CascadeUtils.EvaluateVixTermStructure(vix9d: 12.5, vix: 15.3);
        Assert.True(r.Passed);
        Assert.False(r.NoData);
        Assert.Equal(12.5, r.Vix9d);
        Assert.Equal(15.3, r.Vix30d);
    }

    [Fact]
    public void Backwardation_NoPasa()
    {
        // VIX9D por encima: estrés de corto plazo. Es el caso para el que existe el gate.
        var r = CascadeUtils.EvaluateVixTermStructure(vix9d: 22.0, vix: 18.0);
        Assert.False(r.Passed);
        Assert.False(r.NoData);
    }

    [Fact]
    public void Iguales_NoPasa()
    {
        // El operador declarado es "lt", no "lte": una curva plana no es contango.
        var r = CascadeUtils.EvaluateVixTermStructure(vix9d: 15.0, vix: 15.0);
        Assert.False(r.Passed);
    }

    [Theory]
    [InlineData(null, 15.3)]
    [InlineData(12.5, null)]
    [InlineData(null, null)]
    public void SinDato_NoBloquea_PeroSeMarca(double? vix9d, double? vix)
    {
        // on_no_data: pass. A diferencia de vix_absolute, quedarse sin el índice NO frena la
        // operatoria: el feed DXLink tiene caídas intermitentes y fail-closed acá sería un freno
        // silencioso de todo RPF.
        var r = CascadeUtils.EvaluateVixTermStructure(vix9d, vix);
        Assert.True(r.Passed);

        // Pero tiene que quedar marcado: si Passed=true y NoData=false, el tablero pintaría un ✓
        // verde y nadie se enteraría de que la guarda dejó de correr.
        Assert.True(r.NoData);
    }

    [Fact]
    public void SinDato_SeDistingueDeUnPassReal()
    {
        // La propiedad que hace honesto al tablero: los dos pasan, pero no son lo mismo.
        var real = CascadeUtils.EvaluateVixTermStructure(12.5, 15.3);
        var vacio = CascadeUtils.EvaluateVixTermStructure(null, null);

        Assert.True(real.Passed);
        Assert.True(vacio.Passed);
        Assert.NotEqual(real.NoData, vacio.NoData);
    }
}
