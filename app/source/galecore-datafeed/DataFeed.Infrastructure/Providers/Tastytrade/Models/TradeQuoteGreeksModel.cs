using Newtonsoft.Json;
using System;
using System.Collections.Generic;

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    public class TradeQuoteGreeksModel
    {
        public TradeModel Trade { get; set; }
        public QuoteModel Quote { get; set; }
        public GreeksModel Greeks { get; set; }
    }
}
