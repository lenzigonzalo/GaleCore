using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DataFeed.Infrastructure.Providers.Fred.Models
{
    public class FredObservationResponseModel
    {
        public string Realtime_start { get; set; }
        public string Realtime_end { get; set; }
        public string Observation_start { get; set; }
        public string Observation_end { get; set; }
        public string Units { get; set; }
        public int Output_type { get; set; }
        public string File_type { get; set; }
        public string Order_by { get; set; }
        public string Sort_order { get; set; }
        public int Count { get; set; }
        public int Offset { get; set; }
        public int Limit { get; set; }
        public List<Observation> Observations { get; set; }

        public class Observation
        {
            public string Realtime_start { get; set; }
            public string Realtime_end { get; set; }
            public string Date { get; set; }
            public string Value { get; set; }
        }
    }
}
