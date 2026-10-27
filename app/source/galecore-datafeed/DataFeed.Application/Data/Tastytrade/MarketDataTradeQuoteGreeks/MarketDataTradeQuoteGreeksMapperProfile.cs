using AutoMapper;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using System.Linq;

namespace DataFeed.Application.Data.Tastytrade.MarketDataTradeQuoteGreeks
{
    public class MarketDataTradeQuoteGreeksMapperProfile : AutoMapper.Profile
    {
        public MarketDataTradeQuoteGreeksMapperProfile()
        {
            // Mapeo del modelo combinado al response
            CreateMap<TradeQuoteGreeksModel, MarketDataTradeQuoteGreeksResponse>()
                .ForMember(dest => dest.Trade, opt => opt.MapFrom(src =>
                    src.Trade != null && src.Trade.Data != null && src.Trade.Data.Count > 0 ? src.Trade.Data.First() : null))
                .ForMember(dest => dest.Quote, opt => opt.MapFrom(src =>
                    src.Quote != null && src.Quote.Data != null && src.Quote.Data.Count > 0 ? src.Quote.Data.First() : null))
                .ForMember(dest => dest.Greeks, opt => opt.MapFrom(src =>
                    src.Greeks != null && src.Greeks.Data != null && src.Greeks.Data.Count > 0 ? src.Greeks.Data.First() : null));

            // Mapeo de cada evento individual al DTO plano
            CreateMap<Infrastructure.Providers.Tastytrade.Models.TradeEvent, TradeData>();
            CreateMap<Infrastructure.Providers.Tastytrade.Models.QuoteEvent, QuoteData>();
            CreateMap<Infrastructure.Providers.Tastytrade.Models.GreeksEvent, GreeksData>();
        }
    }
}
