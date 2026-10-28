using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using DataFeed.Application.Data.Tastytrade.MarketDataGreeks;
using DataFeed.Application.Shared;
using Xunit;

namespace DataFeed.Tests
{
    /// <summary>
    /// WS-0062: el agente del Lab pedía velas con FromTime en epoch o sin Interval y griegas con el símbolo
    /// streamer de la cadena. Ahora se aceptan esos formatos, o se contesta 400 con el formato esperado.
    /// </summary>
    public class MarketDataRequestFormatTests
    {
        private static readonly DateTime Esperada = new(2016, 10, 19, 0, 0, 0, DateTimeKind.Utc);

        [Theory]
        [InlineData("1476835200000")]          // epoch en milisegundos
        [InlineData("1476835200")]             // epoch en segundos
        [InlineData("2016-10-19")]             // fecha ISO
        [InlineData("2016-10-19T00:00:00Z")]
        public void Velas_FromTime_AceptaIsoYEpoch(string fromTime)
        {
            var request = MarketDataCandleRequest.FromQuery("SPY", "1d", fromTime, null);

            Assert.Equal(Esperada, request.FromTime);
            Assert.Equal(DateTimeKind.Utc, request.FromTime.Kind);
            Assert.Null(request.ToTime);
        }

        [Fact]
        public void Velas_ToTime_AceptaEpoch()
        {
            var request = MarketDataCandleRequest.FromQuery("SPY", " 1h ", "2016-10-19", "1476921600000");

            Assert.Equal("1h", request.Interval);
            Assert.Equal(Esperada.AddDays(1), request.ToTime);
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("diario")]
        public void Velas_IntervalFaltanteOInvalido_Es400ConLosValoresValidos(string? interval)
        {
            var ex = Assert.Throws<ValidationException>(() => MarketDataCandleRequest.FromQuery("SPY", interval, "2016-10-19", null));

            Assert.Contains("1d", ex.Message);
            Assert.Contains("5m", ex.Message);
        }

        [Fact]
        public void Velas_FromTimeFaltanteOIlegible_Es400()
        {
            Assert.Throws<ValidationException>(() => MarketDataCandleRequest.FromQuery("SPY", "1d", null, null));
            var ex = Assert.Throws<ValidationException>(() => MarketDataCandleRequest.FromQuery("SPY", "1d", "ayer", null));
            Assert.Contains("FromTime", ex.Message);
        }

        [Theory]
        [InlineData(".SPXW261026P6800", ".SPXW261026P6800")]           // streamer de DXLink, como lo devuelve la cadena
        [InlineData(".TSLA260904P352.5", ".TSLA260904P352.5")]
        [InlineData("SPXW  261026P06800000", ".SPXW261026P6800")]       // OCC de 21 caracteres
        public void Griegas_AceptaOccYStreamer(string symbol, string streamer)
        {
            Assert.Equal(streamer, MarketDataGreeksHandler.ResolveSymbol(symbol));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("SPY")]
        [InlineData("SPXW261026P6800")]       // le falta el punto del streamer y no mide 21
        public void Griegas_SimboloInvalido_Es400ConLosDosFormatos(string? symbol)
        {
            var ex = Assert.Throws<ValidationException>(() => MarketDataGreeksHandler.ResolveSymbol(symbol));

            Assert.Contains("21 caracteres", ex.Message);
            Assert.Contains("streamer", ex.Message);
        }
    }
}
