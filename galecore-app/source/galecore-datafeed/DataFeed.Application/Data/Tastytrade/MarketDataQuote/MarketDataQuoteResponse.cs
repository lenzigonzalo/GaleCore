using DataFeed.Application.Dtos;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Text;

namespace DataFeed.Application.Data.Tastytrade.MarketDataQuote
{
    public class MarketDataQuoteResponse
    {
        public string Type { get; set; }
        public int Channel { get; set; }
        public List<QuoteEvent> Data { get; set; }
    }

    public class QuoteEvent
    {
        public string EventType { get; set; }
        public string EventSymbol { get; set; }
        public long EventTime { get; set; }
        public long Sequence { get; set; }
        public double BidPrice { get; set; }
        public double BidSize { get; set; }
        public double AskPrice { get; set; }
        public double AskSize { get; set; }
        public string BidExchangeCode { get; set; }
        public string AskExchangeCode { get; set; }

        /// <summary>Hora (epoch ms) del último cambio del bid / del ask; 0 = no vino (BL-013).</summary>
        public long BidTime { get; set; }
        public long AskTime { get; set; }

        // Campo calculado para el precio medio (Mid)
        public double MidPrice => (BidPrice + AskPrice) / 2;
    }
}