using System;
using System.Collections.Generic;

namespace DataFeed.Application.Data.Tastytrade.AccountSpreads
{
    public class AccountSpreadsResponse
    {
        public List<AccountSpreadDto> Spreads { get; set; } = new();
        /// <summary>Acciones y ETFs de la cuenta (no forman spreads, pero cuentan en la exposición).</summary>
        public List<AccountEquityDto> Equities { get; set; } = new();
        /// <summary>Mid de cada subyacente y acción de la cuenta (para la exposición en dólares).</summary>
        public Dictionary<string, double> UnderlyingPrices { get; set; } = new();
        public DateTime AsOf { get; set; }
    }

    /// <summary>
    /// Un spread de crédito de la cuenta. Montos en USD de la posición entera (× multiplicador ×
    /// contratos), salvo los créditos, que van por acción como los cotiza el bróker.
    /// </summary>
    public class AccountSpreadDto
    {
        /// <summary>"{subyacente}|{vencimiento}", el mismo id con el que el Monitor agrupa las patas.</summary>
        public string Id { get; set; } = "";
        public string UnderlyingSymbol { get; set; } = "";
        public string Expiration { get; set; } = "";
        /// <summary>PUT_CS, CALL_CS o IC.</summary>
        public string Structure { get; set; } = "";
        public decimal Contracts { get; set; }
        public decimal Multiplier { get; set; }
        /// <summary>Ancho que puede perderse: en un IC sólo pierde un lado, así que es el mayor de los dos.</summary>
        public double Width { get; set; }
        public double? ShortPutStrike { get; set; }
        public double? LongPutStrike { get; set; }
        public double? ShortCallStrike { get; set; }
        public double? LongCallStrike { get; set; }

        public double InitialCredit { get; set; }
        /// <summary>Crédito neto para cerrar hoy (mid de cada pata; cierre anterior si no hay cotización).</summary>
        public double? CurrentNetCredit { get; set; }
        /// <summary>true si las patas vendidas tienen cotización en vivo.</summary>
        public bool HasLiveQuote { get; set; }

        public double MaxProfit { get; set; }
        public double MaxLoss { get; set; }

        /// <summary>Probabilidad de ganar al vencimiento, en %: 1 − crédito/ancho.</summary>
        public double? Pop { get; set; }
        /// <summary>Probabilidad de llegar al 50 % del crédito, en %: (100 + POP)/2.</summary>
        public double? Pop50 { get; set; }
        /// <summary>"vivo" si el POP usa el crédito de hoy, "entrada" si usa el de apertura.</summary>
        public string PopBasis { get; set; } = "entrada";

        /// <summary>Crédito neto al cierre anterior (precio de cierre de cada pata).</summary>
        public double? PreviousNetCredit { get; set; }
        /// <summary>Resultado desde la apertura y en el día, en USD; null sin cotización en vivo.</summary>
        public double? OpenPnl { get; set; }
        public double? DayPnl { get; set; }

        /// <summary>Griegas netas de la posición; null si alguna pata no las tiene.</summary>
        public SpreadGreeksDto? Greeks { get; set; }
    }

    public class AccountEquityDto
    {
        public string Symbol { get; set; } = "";
        /// <summary>Con signo: negativa si está vendida.</summary>
        public double Quantity { get; set; }
        public double AverageOpenPrice { get; set; }
        public double ClosePrice { get; set; }
        public double? Mid { get; set; }
        public double? OpenPnl { get; set; }
        public double? DayPnl { get; set; }
    }

    /// <summary>
    /// Σ signo × griega de la pata × multiplicador × contratos (vendida −1, comprada +1). Delta y
    /// gamma en acciones equivalentes; theta en USD por día; vega en USD por punto de volatilidad.
    /// </summary>
    public class SpreadGreeksDto
    {
        public double Delta { get; set; }
        public double Gamma { get; set; }
        public double Theta { get; set; }
        public double Vega { get; set; }
        /// <summary>IV de la pata vendida (en un IC, la del put), en fracción.</summary>
        public double? ShortLegIv { get; set; }
    }
}
