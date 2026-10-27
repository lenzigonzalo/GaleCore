using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DataFeed.Infrastructure.Providers.Fred.Models
{
    public class FredSerieResponseModel
    {
        public List<FredSerie>? Seriess { get; set; }
    }

    public class FredSerie
    {
        public string Id { get; set; }
        public string Title { get; set; }
        public string Frequency { get; set; }
        public string Units { get; set; }
        public string ObservationStart { get; set; }
        public string ObservationEnd { get; set; }
        public string SeasonalAdjustment { get; set; }
        public string LastUpdated { get; set; }
        public int Popularity { get; set; }
        public string Notes { get; set; }
    }
}
