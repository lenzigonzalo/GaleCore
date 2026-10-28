using DataFeed.Application.Dtos;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Text;

namespace DataFeed.Application.Data.Tastytrade.MarketDataGreeks
{
    public class MarketDataGreeksResponse
    {
        public string Type { get; set; }
        public int Channel { get; set; }
        public List<GreeksEvent> Data { get; set; }
    }

    public class GreeksEvent
    {
        public string EventType { get; set; }
        public string EventSymbol { get; set; }
        public long EventTime { get; set; }
        public long Time { get; set; }
        public long Index { get; set; }
        public double Price { get; set; } // Precio teórico de la opción
        public double Volatility { get; set; } // IV (Volatilidad Implícita)
        public double Delta { get; set; }
        public double Gamma { get; set; }
        public double Theta { get; set; }
        public double Rho { get; set; }
        public double Vega { get; set; }

        public DateTime TimeStamp
        {
            get
            {
                return DateTimeOffset.FromUnixTimeMilliseconds(Time).DateTime;
            }
        }
    }
}