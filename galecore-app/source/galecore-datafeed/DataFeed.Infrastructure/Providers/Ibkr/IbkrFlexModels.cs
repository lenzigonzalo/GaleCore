using System.Globalization;
using System.Xml;
using System.Xml.Linq;

namespace DataFeed.Infrastructure.Providers.Ibkr
{
    /// <summary>Token de Flex y Query ID del usuario (el token nunca se loguea ni sale en mensajes).</summary>
    public sealed record IbkrCredentials(string Token, string QueryId);

    public sealed class IbkrPosition
    {
        public string Symbol { get; set; } = "";
        public string? Description { get; set; }
        public string? AssetCategory { get; set; }
        public string? ListingExchange { get; set; }
        public string? Currency { get; set; }
        public decimal? Quantity { get; set; }
        public decimal? Multiplier { get; set; }
        public decimal? MarkPrice { get; set; }
        public decimal? PositionValue { get; set; }
        public decimal? CostBasisPrice { get; set; }
        public decimal? CostBasisMoney { get; set; }
        public decimal? FifoPnlUnrealized { get; set; }
        public string? PutCall { get; set; }
        public decimal? Strike { get; set; }
        public string? Expiry { get; set; }
        public string? UnderlyingSymbol { get; set; }
        public decimal? FxRateToBase { get; set; }
    }

    public sealed class IbkrCash
    {
        public string Currency { get; set; } = "";
        public decimal? EndingCash { get; set; }
    }

    /// <summary>Un <c>FlexStatement</c> (una cuenta) del reporte.</summary>
    public sealed class IbkrStatement
    {
        public string Account { get; set; } = "";
        public string? FromDate { get; set; }
        public string? ToDate { get; set; }
        public DateTime? WhenGenerated { get; set; }
        public string? BaseCurrency { get; set; }
        public decimal? Nav { get; set; }
        public List<IbkrPosition> Positions { get; set; } = new();
        public List<IbkrCash> Cash { get; set; } = new();
    }

    public sealed class IbkrFlexReport
    {
        public List<IbkrStatement> Statements { get; set; } = new();
    }

    /// <summary>IBKR rechazó el token o la Query ID (códigos 1012 / 1013 / 1014 / 1015). Mismo <see cref="Code"/> que IOL y Tastytrade.</summary>
    public sealed class IbkrCredentialInvalidException : Exception
    {
        public const string Code = "broker_credential_invalid";

        public IbkrCredentialInvalidException(string message) : base(message)
        {
        }
    }

    /// <summary>
    /// Lee el XML del Flex Web Service de IBKR. Pura (sin red) para probarla con un fixture. Atributos faltantes quedan en
    /// null; los decimales se leen con cultura invariante.
    /// </summary>
    public static class IbkrFlexParser
    {
        /// <summary>Raíz del documento: <c>FlexQueryResponse</c> (el reporte) o <c>FlexStatementResponse</c> (estado o error).</summary>
        public static XDocument Load(string xml)
        {
            using var reader = XmlReader.Create(new StringReader(xml), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null });
            return XDocument.Load(reader);
        }

        public static IbkrFlexReport ParseReport(XDocument doc)
        {
            var report = new IbkrFlexReport();
            foreach (var st in doc.Descendants("FlexStatement"))
            {
                var s = new IbkrStatement
                {
                    Account = Str(st, "accountId") ?? "",
                    FromDate = NormalizeDate(Str(st, "fromDate")),
                    ToDate = NormalizeDate(Str(st, "toDate")),
                    WhenGenerated = ParseDateTime(Str(st, "whenGenerated")),
                    BaseCurrency = st.Descendants("AccountInformation").Select(a => Str(a, "currency")).FirstOrDefault(c => c != null),
                };
                foreach (var p in st.Descendants("OpenPosition"))
                {
                    // Con detalle por lote, las filas LOT repiten las SUMMARY: sólo se queda el resumen.
                    var level = Str(p, "levelOfDetail");
                    if (level != null && !level.Equals("SUMMARY", StringComparison.OrdinalIgnoreCase)) continue;
                    s.Positions.Add(new IbkrPosition
                    {
                        Symbol = Str(p, "symbol") ?? "",
                        Description = Str(p, "description"),
                        AssetCategory = Str(p, "assetCategory"),
                        ListingExchange = Str(p, "listingExchange"),
                        Currency = Str(p, "currency"),
                        Quantity = Dec(p, "position"),
                        Multiplier = Dec(p, "multiplier"),
                        MarkPrice = Dec(p, "markPrice"),
                        PositionValue = Dec(p, "positionValue"),
                        CostBasisPrice = Dec(p, "costBasisPrice"),
                        CostBasisMoney = Dec(p, "costBasisMoney"),
                        FifoPnlUnrealized = Dec(p, "fifoPnlUnrealized"),
                        PutCall = Str(p, "putCall"),
                        Strike = Dec(p, "strike"),
                        Expiry = NormalizeDate(Str(p, "expiry")),
                        UnderlyingSymbol = Str(p, "underlyingSymbol"),
                        FxRateToBase = Dec(p, "fxRateToBase"),
                    });
                }
                // BASE_SUMMARY es el total en moneda base: ya está en el NAV, no se duplica como saldo.
                foreach (var c in st.Descendants("CashReportCurrency"))
                {
                    var currency = Str(c, "currency");
                    if (currency == null || currency.Equals("BASE_SUMMARY", StringComparison.OrdinalIgnoreCase)) continue;
                    s.Cash.Add(new IbkrCash { Currency = currency, EndingCash = Dec(c, "endingCash") });
                }
                // NAV: la fila de reportDate más reciente (las fechas yyyyMMdd ordenan como texto).
                var nav = st.Descendants("EquitySummaryByReportDateInBase")
                    .OrderByDescending(e => Str(e, "reportDate") ?? "").FirstOrDefault();
                s.Nav = nav == null ? null : Dec(nav, "total");
                report.Statements.Add(s);
            }
            return report;
        }

        private static string? Str(XElement e, string name)
        {
            var v = (string?)e.Attribute(name);
            return string.IsNullOrWhiteSpace(v) ? null : v.Trim();
        }

        private static decimal? Dec(XElement e, string name) =>
            decimal.TryParse(Str(e, name), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;

        /// <summary>yyyyMMdd o yyyy-MM-dd → yyyy-MM-dd; lo que no se entienda queda como vino.</summary>
        public static string? NormalizeDate(string? raw)
        {
            if (raw == null) return null;
            return DateTime.TryParseExact(raw, new[] { "yyyyMMdd", "yyyy-MM-dd" }, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
                ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : raw;
        }

        /// <summary>«20251121;163045», «20251121, 163045» o sólo la fecha. Se toma como UTC.</summary>
        public static DateTime? ParseDateTime(string? raw)
        {
            if (raw == null) return null;
            var formats = new[] { "yyyyMMdd;HHmmss", "yyyyMMdd, HHmmss", "yyyyMMdd HHmmss", "yyyyMMdd;HH:mm:ss", "yyyyMMdd", "yyyy-MM-dd;HH:mm:ss", "yyyy-MM-dd" };
            return DateTime.TryParseExact(raw, formats, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d)
                ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : null;
        }
    }
}
