using MediatR;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DataFeed.Application.Shared
{
    public class TastytradeHelper
    {
        /// <summary>
        /// OCC (21 chars) → símbolo streamer de DXLink. Ej: "TSLA  260904P00352500" → ".TSLA260904P352.5"
        /// </summary>
        /// <remarks>
        /// Los 3 decimales del strike (chars 18-20) son parte del símbolo, no relleno. Hasta el
        /// 2026-08-24 esta función leía solo los 5 enteros y devolvía ".TSLA260904P352" para el
        /// strike 352.5: un símbolo que en DXLink no existe. El feed no falla — devuelve vacío y el
        /// request agota su timeout de 10s —, así que cualquier opción de strike fraccionario venía
        /// sin datos y sin error. La cadena de TSLA a 11 DTE tenía 31 strikes así, 27 con OI.
        /// Afectaba a los cinco handlers que traducen OCC (Quote, Trade, Greeks, TradeQuoteGreeks,
        /// Candle); el GEX se salvaba porque arma sus símbolos desde el strikeMap de la cadena.
        /// </remarks>
        public static string GetOptionSymbolFromTicker(string ticker)
        {
            var root   = ticker.Substring(0, 6).Trim(' ');
            var date   = ticker.Substring(6, 6);
            var type   = ticker.Substring(12, 1);
            var whole  = Convert.ToInt32(ticker.Substring(13, 5)).ToString(CultureInfo.InvariantCulture);
            // "500" → ".5" ; "000" → "" (un strike entero va sin punto decimal, como espera DXLink)
            var frac   = ticker.Substring(18, 3).TrimEnd('0');
            var strike = frac.Length > 0 ? whole + "." + frac : whole;

            return "." + root + date + type + strike;
        }

        public static string GetStockSymbolFromTicker(string ticker)
        {
            return ticker.Substring(0, 6).Trim(' ');
        }

        public static decimal GetStrikeFromTicker(string ticker)
        {
            string intpart = ticker.Substring(13, 5);
            string decpart = ticker.Substring(18, 3);
            decimal value = decimal.Parse(intpart) + decimal.Parse(decpart) / 1000;
            return value;
        }

        public static int GetDTEFromTicker(string ticker, DateTime priceTime)
        {
            var datePart = ticker.Substring(6, 6);

            if (!DateTime.TryParseExact(datePart, "yyMMdd",
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out DateTime expirationDate))
            {
                throw new ArgumentException($"Invalid date format in symbol: {datePart}");
            }

            // Calcular diferencia en días
            int dte = (expirationDate.Date - priceTime.Date).Days;

            return dte;
        }

        /// <summary>
        /// Símbolo streamer de DXLink (".SPXW261026P6800", ".TSLA260904P352.5"): el que devuelve la cadena de opciones.
        /// </summary>
        public static bool IsStreamerOptionSymbol(string ticker)
        {
            return ticker != null && System.Text.RegularExpressions.Regex.IsMatch(ticker, @"^\.[A-Z0-9]{1,6}\d{6}[CP]\d+(\.\d+)?$");
        }

        public static bool IsOptionSymbol(string ticker)
        {
            return (ticker.Length == 21 && (ticker.Substring(12,1) == "C" || ticker.Substring(12, 1) == "P")) ? true : false;
        }
    }
}
