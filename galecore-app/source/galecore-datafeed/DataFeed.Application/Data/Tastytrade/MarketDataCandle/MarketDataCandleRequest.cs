using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using DataFeed.Application.Shared;
using MediatR;
using System.Globalization;
using System.Text.RegularExpressions;

namespace DataFeed.Application.Data.Tastytrade.MarketDataCandle
{
    public class MarketDataCandleRequest : IRequest<MarketDataCandleResponse>
    {
        public string Symbol { get; set; }

        public string Interval { get; set; }

        public DateTime FromTime { get; set; }

        public DateTime? ToTime { get; set; }

        private const string FormatoIntervalo = "Interval es obligatorio: un número y una unidad (1d, 1h, 30m, 5m; unidades s, m, h, d, w, mo, y).";
        private static readonly Regex IntervaloValido = new(@"^\d*(s|m|h|d|w|mo|y)$", RegexOptions.Compiled);

        /// <summary>
        /// Arma el pedido desde el query string. Acepta la fecha ISO (2026-10-01) y también epoch en
        /// milisegundos o segundos (lo que suele mandar quien lee velas de otra fuente); todo se toma como UTC.
        /// Un pedido mal armado es 400 con el formato esperado, no un 500.
        /// </summary>
        public static MarketDataCandleRequest FromQuery(string? symbol, string? interval, string? fromTime, string? toTime)
        {
            if (string.IsNullOrWhiteSpace(symbol))
                throw new ValidationException("Symbol es obligatorio.");
            if (string.IsNullOrWhiteSpace(interval) || !IntervaloValido.IsMatch(interval.Trim()))
                throw new ValidationException(FormatoIntervalo);

            return new MarketDataCandleRequest
            {
                Symbol = symbol!,
                Interval = interval.Trim(),
                FromTime = ParseTime(fromTime, "FromTime") ?? throw new ValidationException("FromTime es obligatorio: fecha ISO (2026-10-01) o epoch en milisegundos o segundos."),
                ToTime = ParseTime(toTime, "ToTime"),
            };
        }

        public static DateTime? ParseTime(string? value, string field)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            value = value.Trim();

            if (long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var epoch))
            {
                // Desde 1e11 es milisegundos (en segundos sería el año 5138).
                var offset = epoch >= 100_000_000_000
                    ? DateTimeOffset.FromUnixTimeMilliseconds(epoch)
                    : DateTimeOffset.FromUnixTimeSeconds(epoch);
                return offset.UtcDateTime;
            }

            if (DateTime.TryParse(value, CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var date))
                return date;

            throw new ValidationException($"{field} inválido: fecha ISO (2026-10-01) o epoch en milisegundos o segundos.");
        }
    }
}