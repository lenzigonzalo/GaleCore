using DataFeed.Infrastructure.Providers.Sec;

namespace DataFeed.Tests;

/// <summary>WS-0045: el 10-K como texto por ítems; el índice no le gana al cuerpo.</summary>
public class SecDocumentTextTests
{
    private const string Html = """
        <html><head><style>p{}</style></head><body>
        <ix:header><ix:hidden>dato oculto</ix:hidden></ix:header>
        <p>Table of Contents</p>
        <p>Item 1. Business</p><p>Item 1A. Risk Factors</p><p>Item 7. Management&#8217;s Discussion</p>
        <p>Item 1. Business</p>
        <p>The Company designs smartphones, personal computers and wearables, and sells services.</p>
        <table><tr><td>iPhone</td><td>$ 201,183</td></tr><tr><td>Services</td><td>$ 96,169</td></tr></table>
        <p>Item 1A. Risk Factors</p>
        <p>Global economic conditions could adversely affect the Company.</p>
        <p>Item 7. Management&#8217;s Discussion and Analysis</p>
        <p>Total net sales increased 2% during 2025.</p>
        </body></html>
        """;

    [Fact]
    public void Cada_item_trae_su_cuerpo_y_no_la_linea_del_indice()
    {
        var items = SecDocumentText.Items(SecDocumentText.ToText(Html), new[] { "1", "1a", "7", "9" }, 30000);

        Assert.Equal(new[] { "1", "1A", "7" }, items.Select(i => i.Item));
        Assert.Contains("designs smartphones", items[0].Text);
        Assert.Contains("iPhone | $ 201,183", items[0].Text);          // las celdas de la tabla quedan separadas
        Assert.Contains("Global economic conditions", items[1].Text);
        Assert.StartsWith("Management", items[2].Title);                 // entidades HTML decodificadas
        Assert.DoesNotContain("dato oculto", SecDocumentText.ToText(Html)); // el encabezado XBRL oculto no entra
    }

    [Fact]
    public void Un_item_largo_se_corta_y_lo_dice()
    {
        var item = SecDocumentText.Items(SecDocumentText.ToText(Html), new[] { "1" }, 1000)[0];
        Assert.False(item.Truncated);
        var cut = SecDocumentText.Items("Item 1. Business\n" + new string('x', 5000), new[] { "1" }, 1000)[0];
        Assert.True(cut.Truncated);
        Assert.Equal(1000, cut.Text.Length);
        Assert.Equal(5000, cut.Chars);
    }
}
