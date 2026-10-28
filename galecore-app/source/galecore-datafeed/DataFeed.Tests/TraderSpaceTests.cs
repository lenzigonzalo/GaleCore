using DataFeed.Repositories.Entities;
using Xunit;

namespace DataFeed.Tests
{
    /// <summary>GC-0007: las reglas de una pieza del espacio del trader (las mismas que los CHECK de la base).</summary>
    public class TraderSpaceTests
    {
        [Fact]
        public void UnaPiezaValidaSeAcepta()
        {
            Assert.Null(TraderSpaceItem.Validate("objective", "rentabilidad-anual", "Rentabilidad", "12 % anual", "markdown", "private"));
            Assert.Null(TraderSpaceItem.Validate("agent", "oportunidades", "Agente", "{\"minutes\":30}", "json", "shared"));
        }

        [Theory]
        [InlineData("estrategia", "x", "t", "c", "markdown", "private")]   // tipo desconocido
        [InlineData("memory", "Con Mayúscula", "t", "c", "markdown", "private")]
        [InlineData("memory", "ok", " ", "c", "markdown", "private")]       // sin título
        [InlineData("memory", "ok", "t", "c", "html", "private")]
        [InlineData("memory", "ok", "t", "c", "markdown", "public")]
        [InlineData("memory", "ok", "t", "{no es json", "json", "private")]
        public void LoInvalidoSeRechazaConMotivo(string kind, string key, string title, string content, string format, string visibility)
        {
            Assert.NotNull(TraderSpaceItem.Validate(kind, key, title, content, format, visibility));
        }

        [Fact]
        public void LosTiposSonLosQueAcordamos()
        {
            Assert.Equal(new[] { "profile", "objective", "convention", "memory", "skill", "agent", "data", "preference", "idea" }, TraderSpaceItem.Kinds);
        }
    }
}
