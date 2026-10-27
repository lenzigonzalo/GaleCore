namespace DataFeed.Application.Dtos
{
    public class PriceQuoteDTO
    {
        public string Symbol { get; set; }
        //public string InstrumentType { get; set; }
        //public DateTime UpdatedAt { get; set; }
        public DateTime Date { get; set; }
        public double Bid { get; set; }
        public double Ask { get; set; }
        public double Last { get; set; }
        public double Mark { get; set; }
        public double Mid { get; set; }
        public double Close { get; set; }
    }
}