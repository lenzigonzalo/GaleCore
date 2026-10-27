using System.Net;
using System.Text.RegularExpressions;

namespace DataFeed.Infrastructure.Providers.Sec
{
    public record SecDocumentItem(string Item, string Title, string Text, int Chars, bool Truncated);

    /// <summary>
    /// Un 10-K/10-Q de EDGAR (HTML con XBRL en línea) como texto por ítems (WS-0045). Puro, sin red, para probarlo.
    /// El índice del principio repite los títulos «Item 1.», «Item 1A.»…: de cada ítem se toma la aparición con más
    /// texto hasta el ítem siguiente, que es el cuerpo y no la línea del índice.
    /// </summary>
    public static class SecDocumentText
    {
        private static readonly Regex Hidden = new(@"<(script|style|ix:header)\b.*?</\1>", RegexOptions.Singleline | RegexOptions.IgnoreCase);
        private static readonly Regex Block = new(@"<\s*(br|/p|/div|/tr|/li|/h\d|/table)\b[^>]*>", RegexOptions.IgnoreCase);
        private static readonly Regex Cell = new(@"<\s*/t[dh]\b[^>]*>", RegexOptions.IgnoreCase);
        private static readonly Regex Tag = new(@"<[^>]+>");
        private static readonly Regex Spaces = new(@"[ \t ]+");
        private static readonly Regex Blank = new(@"\n\s*\n+");
        private static readonly Regex Heading = new(@"^\s*Item\s+(\d{1,2}[A-C]?)\s*[.:]\s*(.{0,120})$", RegexOptions.Multiline | RegexOptions.IgnoreCase);

        public static string ToText(string html)
        {
            var t = Hidden.Replace(html, " ");
            t = Block.Replace(t, "\n");
            t = Cell.Replace(t, " | ");
            t = Tag.Replace(t, " ");
            t = WebUtility.HtmlDecode(t);
            t = Spaces.Replace(t, " ");
            t = string.Join("\n", t.Split('\n').Select(l => l.Trim()));
            return Blank.Replace(t, "\n\n").Trim();
        }

        /// <summary>Los ítems pedidos (p. ej. 1, 1A, 7), cada uno hasta <paramref name="maxChars"/> caracteres.</summary>
        public static List<SecDocumentItem> Items(string text, IReadOnlyCollection<string> wanted, int maxChars)
        {
            var heads = Heading.Matches(text).Cast<Match>().ToList();
            var best = new Dictionary<string, (string Title, string Body)>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < heads.Count; i++)
            {
                var key = heads[i].Groups[1].Value.ToUpperInvariant();
                var start = heads[i].Index + heads[i].Length;
                var end = i + 1 < heads.Count ? heads[i + 1].Index : text.Length;
                var body = text[start..end].Trim();
                if (!best.TryGetValue(key, out var prev) || body.Length > prev.Body.Length)
                    best[key] = (heads[i].Groups[2].Value.Trim().TrimEnd('|', ' '), body);
            }
            return wanted.Select(w => w.Trim().ToUpperInvariant()).Where(w => best.ContainsKey(w)).Select(w =>
            {
                var (title, body) = best[w];
                return new SecDocumentItem(w, title, body.Length > maxChars ? body[..maxChars] : body, body.Length, body.Length > maxChars);
            }).ToList();
        }
    }
}
