using System.Text.RegularExpressions;
using DataFeed.Application.App.Shared;

namespace DataFeed.Tests;

/// <summary>
/// Congela el charset del username, que es con lo que se entra a la plataforma.
///
/// Lo que protege no es la validación de un string sino TRES invariantes que, si se rompen, se
/// rompen en silencio:
///   * la regla de C# y el check de Postgres son la MISMA — si acá se afloja y allá no, el alta
///     explota con un 500 de constraint en vez de con un mensaje que el admin pueda leer;
///   * el username derivado del mail SIEMPRE sale válido, incluso desde un mail raro: si no, el
///     usuario que aparece sin fila (creado en el panel de Supabase) no se puede materializar;
///   * la deduplicación respeta el largo máximo, o el INSERT que resuelve un choque falla por la
///     otra punta.
/// </summary>
public class UsernamesTests
{
    /// <summary>
    /// El patrón declarado tiene que aceptar y rechazar exactamente lo mismo que IsValid. Es el
    /// puente con la base: ese patrón es el que viaja al check de Postgres.
    /// </summary>
    [Theory]
    [InlineData("eric", true)]
    [InlineData("eric.lenzi", true)]
    [InlineData("op_2", true)]
    [InlineData("a-b", true)]
    [InlineData("abc", true)]
    [InlineData("ab", false)]                                   // corto
    [InlineData("", false)]
    [InlineData("Eric", false)]                                 // mayúscula: dos usuarios que se ven iguales
    [InlineData("eric lenzi", false)]                           // espacio
    [InlineData("eric@galecore", false)]                        // no es un mail
    [InlineData("ericñ", false)]                                // fuera del ASCII
    public void El_charset_de_csharp_y_el_de_la_base_dicen_lo_mismo(string candidate, bool esperado)
    {
        Assert.Equal(esperado, Usernames.IsValid(candidate));
        Assert.Equal(esperado, Regex.IsMatch(candidate, Usernames.Pattern));
    }

    [Fact]
    public void El_largo_maximo_se_respeta_en_los_dos_bordes()
    {
        var justo = new string('a', Usernames.MaxLength);
        var pasado = new string('a', Usernames.MaxLength + 1);

        Assert.True(Usernames.IsValid(justo));
        Assert.False(Usernames.IsValid(pasado));
    }

    [Fact]
    public void Normalize_baja_a_minuscula_y_saca_los_espacios_de_los_bordes()
    {
        Assert.Equal("eric", Usernames.Normalize("  Eric "));
        Assert.Equal("", Usernames.Normalize(null));
    }

    /// <summary>
    /// Normalize NO arregla los caracteres inválidos a propósito: si los reemplazara, el admin
    /// escribiría "eric lenzi" y se guardaría otra cosa sin que nadie se lo diga.
    /// </summary>
    [Fact]
    public void Normalize_no_disimula_un_caracter_invalido()
    {
        Assert.False(Usernames.IsValid(Usernames.Normalize("Eric Lenzi")));
    }

    /// <summary>
    /// El invariante del usuario creado en el panel de Supabase: aparece sin fila y hay que
    /// materializarlo. Si el derivado saliera inválido, el INSERT lo rechazaría y ese usuario
    /// quedaría invisible para el admin, sin forma de darle permisos.
    /// </summary>
    [Theory]
    [InlineData("ericlenzi@gmail.com", "ericlenzi")]
    [InlineData("Eric.Lenzi@Gmail.com", "eric.lenzi")]
    [InlineData("eric+trading@gmail.com", "eric-trading")]
    [InlineData("ab@gmail.com", "abu")]                          // corto: se rellena
    [InlineData("@gmail.com", "use")]                            // sin parte local
    [InlineData("", "use")]
    public void El_username_derivado_del_mail_siempre_sale_valido(string email, string esperado)
    {
        var derivado = Usernames.FromEmail(email);

        Assert.Equal(esperado, derivado);
        Assert.True(Usernames.IsValid(derivado), $"'{derivado}' no pasa el charset");
    }

    [Fact]
    public void Un_mail_larguisimo_se_recorta_al_maximo_y_sigue_siendo_valido()
    {
        var derivado = Usernames.FromEmail(new string('a', 80) + "@gmail.com");

        Assert.Equal(Usernames.MaxLength, derivado.Length);
        Assert.True(Usernames.IsValid(derivado));
    }

    [Fact]
    public void Sin_choque_el_nombre_queda_como_estaba()
    {
        Assert.Equal("eric", Usernames.Deduplicate("eric", _ => false));
    }

    [Fact]
    public void Con_choque_se_numera_hasta_encontrar_uno_libre()
    {
        var tomados = new HashSet<string> { "eric", "eric-2" };

        Assert.Equal("eric-3", Usernames.Deduplicate("eric", tomados.Contains));
    }

    /// <summary>
    /// El sufijo no puede empujar el nombre más allá del máximo: si lo hiciera, el choque se
    /// resolvería con un valor que la base rechaza por largo.
    /// </summary>
    [Fact]
    public void El_sufijo_recorta_el_nombre_en_vez_de_pasarse_de_largo()
    {
        var largo = new string('a', Usernames.MaxLength);

        var dedup = Usernames.Deduplicate(largo, n => n == largo);

        Assert.Equal(Usernames.MaxLength, dedup.Length);
        Assert.EndsWith("-2", dedup);
        Assert.True(Usernames.IsValid(dedup));
    }

    /// <summary>
    /// Con todo tomado devuelve el original y deja que el índice único corte. Lo que NO puede hacer
    /// es girar para siempre: una base inalcanzable que contesta "existe" a todo colgaría el request.
    /// </summary>
    [Fact]
    public void Si_no_encuentra_ninguno_libre_corta_y_devuelve_el_original()
    {
        Assert.Equal("eric", Usernames.Deduplicate("eric", _ => true));
    }
}
