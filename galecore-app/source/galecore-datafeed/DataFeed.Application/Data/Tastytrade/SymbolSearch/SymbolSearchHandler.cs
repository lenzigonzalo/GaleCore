using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Application.Data.Tastytrade.SymbolSearch
{
    /// <summary>
    /// Handler de GET /Data/Tastytrade/Symbols/Search — proxy del symbol search de Tastytrade.
    ///
    /// No decide nada: pide, normaliza y devuelve. El único filtro es el que le pasa quien busca
    /// (InstrumentTypes), porque qué tipos de instrumento sirven depende de la pantalla que
    /// pregunta y no de este endpoint.
    ///
    /// **No mapea con AutoMapper** a diferencia de sus vecinos de Data/Tastytrade: la respuesta no
    /// es el espejo del modelo del proveedor sino una proyección de cuatro campos, y un Profile
    /// para eso es un archivo que hace peor lo que hace este Select.
    /// </summary>
    public class SymbolSearchHandler : IRequestHandler<SymbolSearchRequest, SymbolSearchResponse>
    {
        private readonly IConfiguration _config;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;

        public SymbolSearchHandler(IConfiguration config, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _auth = auth;
            _client = client;
        }

        public async Task<SymbolSearchResponse> Handle(SymbolSearchRequest request, CancellationToken cancellationToken)
        {
            var query = (request.Symbol ?? "").Trim().ToUpperInvariant();

            // Búsqueda vacía: lista vacía, no error. Es lo que pasa mientras el operador todavía no
            // escribió nada, y el 500 de un query string vacío no sería información para nadie.
            if (query.Length == 0)
                return new SymbolSearchResponse { Query = query };

            var provider = new TastytradeApiProvider(_config, _auth, _client);
            var found = await provider.GetSymbolSearchAsync(query, cancellationToken);

            var items = found?.Data?.Items ?? new List<SymbolSearchItem>();
            var allowed = ParseInstrumentTypes(request.InstrumentTypes);

            return new SymbolSearchResponse
            {
                Query = query,
                Items = items
                    .Where(i => !string.IsNullOrWhiteSpace(i.Symbol))
                    // Un item sin instrument-type NO se descarta: el filtro saca lo que se sabe que
                    // no sirve, y no tener el dato no es saber que no sirve.
                    .Where(i => allowed.Count == 0
                             || string.IsNullOrWhiteSpace(i.InstrumentType)
                             || allowed.Contains(i.InstrumentType))
                    .Select(i => new SymbolSearchResult
                    {
                        Symbol = i.Symbol!.Trim().ToUpperInvariant(),
                        Description = i.Description,
                        InstrumentType = i.InstrumentType,
                        ListedMarket = i.ListedMarket,
                    })
                    .ToList(),
            };
        }

        private static HashSet<string> ParseInstrumentTypes(string? raw)
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (string.IsNullOrWhiteSpace(raw)) return set;

            foreach (var t in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                set.Add(t);

            return set;
        }
    }
}
