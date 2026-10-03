using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using DataFeed.Infrastructure.Providers.Fred.Models;

namespace DataFeed.Infrastructure.Providers.Fred
{
    public interface IFredApiProvider
    {
        Task<FredSerieResponseModel?> GetSeriesAsync(string seriesId, CancellationToken cancellationToken);

        Task<FredObservationResponseModel?> GetObservationsAsync(string observationId, DateTime? fromTime, DateTime? toTime, CancellationToken cancellationToken);

        Task<(List<FredReleaseDate> Rows, string UpstreamUrl)> GetReleaseDatesAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken);
    }
}
