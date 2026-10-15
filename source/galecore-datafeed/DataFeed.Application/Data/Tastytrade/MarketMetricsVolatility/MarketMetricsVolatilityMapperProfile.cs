using AutoMapper;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using System.Globalization;

namespace DataFeed.Application.Data.Tastytrade.MarketMetricsVolatility
{
    public class MarketMetricsVolatilityMapperProfile : AutoMapper.Profile
    {
        public MarketMetricsVolatilityMapperProfile()
        {
            CreateMap<MarketMetricsVolatilityItem, MarketMetricsVolatilityDto>()
                .ForMember(d => d.ImpliedVolatilityIndex,        opt => opt.MapFrom(s => ParseDecimal(s.ImpliedVolatilityIndex)))
                .ForMember(d => d.ImpliedVolatilityIndex5DayChange, opt => opt.MapFrom(s => ParseDecimal(s.ImpliedVolatilityIndex5DayChange)))
                .ForMember(d => d.ImpliedVolatilityPercentile,   opt => opt.MapFrom(s => ParseDecimal(s.ImpliedVolatilityPercentile)))
                .ForMember(d => d.ImpliedVolatility30Day,        opt => opt.MapFrom(s => ParseDecimal(s.ImpliedVolatility30Day)))
                .ForMember(d => d.ImpliedVolatility60Day,        opt => opt.MapFrom(s => ParseDecimal(s.ImpliedVolatility60Day)))
                .ForMember(d => d.ImpliedVolatility90Day,        opt => opt.MapFrom(s => ParseDecimal(s.ImpliedVolatility90Day)))
                .ForMember(d => d.ImpliedVolatility180Day,       opt => opt.MapFrom(s => ParseDecimal(s.ImpliedVolatility180Day)))
                .ForMember(d => d.ImpliedVolatility360Day,       opt => opt.MapFrom(s => ParseDecimal(s.ImpliedVolatility360Day)))
                .ForMember(d => d.HistoricalVolatility30Day,     opt => opt.MapFrom(s => ParseDecimal(s.HistoricalVolatility30Day)))
                .ForMember(d => d.HistoricalVolatility60Day,     opt => opt.MapFrom(s => ParseDecimal(s.HistoricalVolatility60Day)))
                .ForMember(d => d.HistoricalVolatility90Day,     opt => opt.MapFrom(s => ParseDecimal(s.HistoricalVolatility90Day)))
                .ForMember(d => d.HistoricalVolatility180Day,    opt => opt.MapFrom(s => ParseDecimal(s.HistoricalVolatility180Day)))
                .ForMember(d => d.HistoricalVolatility360Day,    opt => opt.MapFrom(s => ParseDecimal(s.HistoricalVolatility360Day)))
                .ForMember(d => d.IvHv30DayDifference,          opt => opt.MapFrom(s => ParseDecimal(s.IvHv30DayDifference)))
                .ForMember(d => d.IvHv60DayDifference,          opt => opt.MapFrom(s => ParseDecimal(s.IvHv60DayDifference)))
                .ForMember(d => d.IvHv90DayDifference,          opt => opt.MapFrom(s => ParseDecimal(s.IvHv90DayDifference)))
                .ForMember(d => d.Beta,                          opt => opt.MapFrom(s => ParseDecimal(s.Beta)))
                .ForMember(d => d.MarketCap,                     opt => opt.MapFrom(s => s.MarketCap))
                .ForMember(d => d.CorrSpy3Month,                 opt => opt.MapFrom(s => ParseDecimal(s.CorrSpy3Month)))
                .ForMember(d => d.LiquidityRank,                 opt => opt.MapFrom(s => ParseDecimal(s.LiquidityRank)));

            CreateMap<ExpirationImpliedVolatility, ExpirationImpliedVolatilityDto>()
                .ForMember(d => d.LowVolatility,      opt => opt.MapFrom(s => ParseDecimal(s.LowVolatility)))
                .ForMember(d => d.HighVolatility,     opt => opt.MapFrom(s => ParseDecimal(s.HighVolatility)))
                .ForMember(d => d.ImpliedVolatility,  opt => opt.MapFrom(s => ParseDecimal(s.ImpliedVolatility)));
        }

        private static decimal? ParseDecimal(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Trim() == "NaN") return null;
            return decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var result)
                ? result
                : null;
        }
    }
}
