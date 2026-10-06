using System.Text.RegularExpressions;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Sec;
using MediatR;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Application.Data.Sec
{
    /// <summary>Empresa por ticker o por CIK (uno de los dos).</summary>
    public abstract class SecCompanyQuery
    {
        /// <summary>Ticker (ej: AAPL). Se resuelve a CIK con company_tickers.json de la SEC.</summary>
        public string? Ticker { get; set; }

        /// <summary>CIK (ej: 320193). Si viene, no hace falta el ticker.</summary>
        public string? Cik { get; set; }
    }

    public class SecCompanyRequest : SecCompanyQuery, IRequest<SourcedResponse<SecCompany>>
    {
    }

    public class SecFilingsRequest : SecCompanyQuery, IRequest<SourcedResponse<SecCompanyFilings>>
    {
        /// <summary>Formularios separados por coma (ej: 8-K,10-Q,10-K). Vacío = todos.</summary>
        public string? Forms { get; set; }

        /// <summary>Presentadas desde (YYYY-MM-DD). Vacío = 90 días atrás.</summary>
        public DateTime? Since { get; set; }
    }

    public class SecFactsRequest : SecCompanyQuery, IRequest<SourcedResponse<SecCompanyConcept>>
    {
        /// <summary>Taxonomía XBRL (us-gaap, dei, ifrs-full). Vacío = us-gaap.</summary>
        public string? Taxonomy { get; set; }

        /// <summary>Concepto XBRL (ej: Revenues, NetIncomeLoss, EarningsPerShareDiluted).</summary>
        public string? Tag { get; set; }

        /// <summary>Períodos que terminan desde (YYYY-MM-DD). Vacío = todos.</summary>
        public DateTime? Since { get; set; }
    }

    internal static class SecCommon
    {
        private static readonly Regex Ticker = new(@"^[A-Z][A-Z0-9.\-]{0,9}$");
        private static readonly Regex Cik = new(@"^\d{1,10}$");

        public static readonly List<string> Notes = new()
        {
            "Datos tal como los presentó la empresa ante la SEC; EDGAR no da la fecha futura de resultados (eso sale de FMP o Alpha Vantage).",
        };

        public static async Task<(string Cik, SecCompany? Company)> ResolveAsync(SecCompanyQuery q, SecEdgarProvider provider, CancellationToken ct)
        {
            if (!string.IsNullOrWhiteSpace(q.Cik))
            {
                if (!Cik.IsMatch(q.Cik.Trim()))
                    throw new ValidationException($"Cik inválido: '{q.Cik}'");
                return (SecEdgarProvider.PadCik(long.Parse(q.Cik.Trim())), null);
            }
            var ticker = (q.Ticker ?? "").Trim().ToUpperInvariant();
            if (!Ticker.IsMatch(ticker))
                throw new ValidationException($"Ticker o Cik requerido (Ticker inválido: '{q.Ticker}')");
            var company = await provider.FindTickerAsync(ticker, ct)
                ?? throw new UpstreamSourceException("sec", $"la SEC no lista el ticker {ticker} en company_tickers.json");
            return (company.Cik, company);
        }
    }

    public class SecCompanyHandler : IRequestHandler<SecCompanyRequest, SourcedResponse<SecCompany>>
    {
        private readonly IConfiguration _config;
        private readonly IHttpClientFactory _client;

        public SecCompanyHandler(IConfiguration config, IHttpClientFactory client)
        {
            _config = config;
            _client = client;
        }

        public async Task<SourcedResponse<SecCompany>> Handle(SecCompanyRequest request, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(request.Ticker))
                throw new ValidationException("Ticker requerido.");
            var provider = new SecEdgarProvider(_config, _client.CreateClient());
            var (_, company) = await SecCommon.ResolveAsync(new SecCompanyRequest { Ticker = request.Ticker }, provider, cancellationToken);
            return new SourcedResponse<SecCompany>
            {
                Source = "sec",
                UpstreamUrl = SecEdgarProvider.TickersUrl,
                RetrievedAt = DateTime.UtcNow,
                AsOf = DateTime.UtcNow.ToString("yyyy-MM-dd"),
                Notes = new() { $"Lista de tickers de la SEC, guardada {SecEdgarProvider.TickersCacheFor.TotalHours:0} h en memoria." },
                Data = company!,
            };
        }
    }

    public class SecFilingsHandler : IRequestHandler<SecFilingsRequest, SourcedResponse<SecCompanyFilings>>
    {
        private readonly IConfiguration _config;
        private readonly IHttpClientFactory _client;

        public SecFilingsHandler(IConfiguration config, IHttpClientFactory client)
        {
            _config = config;
            _client = client;
        }

        public async Task<SourcedResponse<SecCompanyFilings>> Handle(SecFilingsRequest request, CancellationToken cancellationToken)
        {
            var forms = (request.Forms ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(f => f.ToUpperInvariant()).ToHashSet();
            var since = (request.Since ?? DateTime.UtcNow.AddDays(-90)).ToString("yyyy-MM-dd");
            var provider = new SecEdgarProvider(_config, _client.CreateClient());
            var (cik, _) = await SecCommon.ResolveAsync(request, provider, cancellationToken);
            var (all, sha) = await provider.GetFilingsAsync(cik, cancellationToken);
            var filings = all.Filings
                .Where(f => (forms.Count == 0 || forms.Contains(f.Form)) && string.CompareOrdinal(f.FilingDate, since) >= 0)
                .ToList();

            return new SourcedResponse<SecCompanyFilings>
            {
                Source = "sec",
                UpstreamUrl = SecEdgarProvider.SubmissionsUrl(cik),
                RetrievedAt = DateTime.UtcNow,
                AsOf = all.Filings.Count > 0 ? all.Filings.Max(f => f.FilingDate) : "",
                Sha256 = sha,
                Notes = new(SecCommon.Notes)
                {
                    "Sólo el bloque reciente de EDGAR (las ~1000 presentaciones más nuevas de la empresa).",
                    "En un 8-K, Items lista los ítems del formulario: 2.02 = resultados, 5.02 = cambios de directivos, 7.01/8.01 = otros anuncios.",
                },
                Data = all with { Filings = filings },
            };
        }
    }

    public class SecFactsHandler : IRequestHandler<SecFactsRequest, SourcedResponse<SecCompanyConcept>>
    {
        private static readonly Regex Taxonomy = new("^[a-z][a-z\\-]{1,20}$");
        private static readonly Regex Tag = new("^[A-Za-z][A-Za-z0-9]{1,150}$");

        private readonly IConfiguration _config;
        private readonly IHttpClientFactory _client;

        public SecFactsHandler(IConfiguration config, IHttpClientFactory client)
        {
            _config = config;
            _client = client;
        }

        public async Task<SourcedResponse<SecCompanyConcept>> Handle(SecFactsRequest request, CancellationToken cancellationToken)
        {
            var taxonomy = string.IsNullOrWhiteSpace(request.Taxonomy) ? "us-gaap" : request.Taxonomy.Trim();
            var tag = (request.Tag ?? "").Trim();
            if (!Taxonomy.IsMatch(taxonomy) || !Tag.IsMatch(tag))
                throw new ValidationException($"Taxonomy/Tag inválidos: '{request.Taxonomy}'/'{request.Tag}'");
            var since = request.Since?.ToString("yyyy-MM-dd");
            var provider = new SecEdgarProvider(_config, _client.CreateClient());
            var (cik, _) = await SecCommon.ResolveAsync(request, provider, cancellationToken);
            var (concept, sha) = await provider.GetConceptAsync(cik, taxonomy, tag, cancellationToken);
            var facts = concept.Facts.Where(f => since == null || string.CompareOrdinal(f.End, since) >= 0).ToList();

            return new SourcedResponse<SecCompanyConcept>
            {
                Source = "sec",
                UpstreamUrl = SecEdgarProvider.ConceptUrl(cik, taxonomy, tag),
                RetrievedAt = DateTime.UtcNow,
                AsOf = concept.Facts.Count > 0 ? concept.Facts.Max(f => f.Filed) : "",
                Sha256 = sha,
                Notes = new(SecCommon.Notes)
                {
                    "Un mismo período aparece en varias presentaciones (el 10-K repite trimestres): Form, Filed y Accession dicen de cuál sale cada valor.",
                    "Frame (ej: CY2026Q2) marca el valor que la SEC usa para comparar entre empresas; los demás son repeticiones.",
                },
                Data = concept with { Facts = facts },
            };
        }
    }
}
