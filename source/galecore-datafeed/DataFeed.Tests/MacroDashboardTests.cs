using DataFeed.Application.App.Macro;
using DataFeed.Application.App.Shared;
using DataFeed.Application.Data.Fred.ReleaseDates;
using DataFeed.Application.Shared;
using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace DataFeed.Tests;

public class MacroDashboardTests
{
    private static MacroObservation O(string id, string date, decimal? value) => new($"{id}:{date}", id,
        value, date, null, null, new DateTime(2026, 10, 13, 17, 0, 0, DateTimeKind.Utc), "day", "https://example.test",
        null, "observed", value == null ? "unavailable" : "available", Array.Empty<string>());
    [Fact]
    public void Month_UsesCalendarAnniversaryAndBasisPoints_NotTwentyObservations()
    {
        var rows = new[] { O("DFII10", "2026-09-10", 2.0m), O("DFII10", "2026-09-11", 2.1m),
            O("DFII10", "2026-09-14", 2.2m), O("DFII10", "2026-10-12", 2.4m) };
        var m = MacroCalculations.Change(MacroCatalog.Definitions.Single(d => d.Id == "DFII10"), rows, "month");
        Assert.Equal(30m, m.Value); Assert.Equal("pb", m.Unit); Assert.Equal("2026-09-11", m.ActualFrom);
        Assert.Equal(new[] { "DFII10:2026-09-11", "DFII10:2026-10-12" }, m.InputRefs);
    }
    [Fact]
    public void MissingAndUnsupported_NeverBecomeZero()
    {
        var d = MacroCatalog.Definitions.Single(d => d.Id == "DFII10");
        Assert.Null(MacroCalculations.Change(d, new[] { O(d.Id, "2026-10-12", null) }, "month").Value);
        Assert.Null(MacroCalculations.Change(d, new[] { O(d.Id, "2026-09-11", 2), O(d.Id, "2026-10-12", 3) }, "five-sessions").Value);
    }
    [Fact]
    public void Slope_RequiresSameDate_AndPropagatesNull()
    {
        var rows = new[] { O("UST2", "2026-10-09", 4), O("UST10", "2026-10-12", 4.5m),
            O("UST2", "2026-10-12", 4.1m), O("UST2", "2026-10-13", null), O("UST10", "2026-10-13", 4.4m) };
        var result = MacroCalculations.Slope("SLOPE2_10", "UST2", "UST10", rows);
        Assert.Equal(2, result.Length); Assert.Equal(40m, result[0].Value); Assert.Null(result[1].Value);
        Assert.Equal("unavailable", result[1].QualityStatus);
        Assert.Contains("UST2:2026-10-12", result[0].QualityReasons[0]);
    }
    [Theory]
    [InlineData("2025-01-01", "Local", "US")]
    [InlineData(null, "USD", "US")]
    [InlineData(null, "Local", "AR")]
    public async Task HistoricalAndUnsupportedScope_RejectBeforeReadingSources(string? cutoff, string currency, string region)
    {
        var handler = new MacroSnapshotHandler(null!);
        await Assert.ThrowsAsync<ValidationException>(() => handler.Handle(new() { Cutoff = cutoff, Currency = currency, Region = region }, default));
    }
    [Fact]
    public async Task FailedSources_KeepStableSixFamiliesAndSuccessfulTreasury()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddMediatR(c => c.RegisterServicesFromAssemblyContaining<MacroSnapshotHandler>());
        var treasury = new TreasuryStub();
        services.AddSingleton<IRequestHandler<DataFeed.Application.Data.Treasury.TreasuryYieldCurveRequest,
            SourcedResponse<List<DataFeed.Application.Data.Treasury.TreasuryCurveDayDto>>>>(treasury);
        using var provider = services.BuildServiceProvider();
        var mediator = provider.GetRequiredService<IMediator>();
        var snapshot = await new MacroSnapshotHandler(mediator).Handle(new(), default);
        Assert.Equal(6, snapshot.SeriesDefinitions.Select(d => d.Family).Distinct().Count());
        Assert.Contains(snapshot.SourceStatuses, s => s.Id == "treasury" && s.Status == "available");
        Assert.Contains(snapshot.SourceStatuses, s => s.Id == "DFII10" && s.Status == "source-error");
        Assert.Contains(snapshot.Observations, o => o.SeriesId == "UST10" && o.Value == 4.5m);
        Assert.Null(snapshot.Metrics.Single(m => m.SeriesId == "DFII10").Value);
        treasury.Fail = true;
        var failedUpdate = await new MacroSnapshotHandler(mediator).Handle(new(), default);
        Assert.Equal(snapshot.Observations.First(o => o.SeriesId == "UST10").RetrievedAt,
            failedUpdate.Observations.First(o => o.SeriesId == "UST10").RetrievedAt);
        Assert.Contains(failedUpdate.SourceStatuses, s => s.Id == "treasury" && s.Status == "source-error");
    }
    /// <summary>Macro y el warm-up de Program.cs piden las mismas publicaciones de FRED que el catálogo de eventos (misma clave de caché diaria).</summary>
    [Fact]
    public async Task FredCalendar_UsesTheCatalogReleaseIds_AlsoInTheWarmUp()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddMediatR(c => c.RegisterServicesFromAssemblyContaining<MacroSnapshotHandler>());
        var fred = new FredReleasesStub();
        services.AddSingleton<IRequestHandler<FredReleaseDatesRequest, SourcedResponse<List<FredReleaseDateDto>>>>(fred);
        using var provider = services.BuildServiceProvider();
        await new MacroSnapshotHandler(provider.GetRequiredService<IMediator>()).Handle(new(), default);
        Assert.Equal(EventCatalog.FredReleaseIdsCsv, fred.ReleaseIds);
        Assert.Equal("9,10,46,50,53,54", fred.ReleaseIds);

        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "DataFeed.Api", "Program.cs"))) dir = dir.Parent;
        var program = File.ReadAllText(Path.Combine(dir!.FullName, "DataFeed.Api", "Program.cs"));
        Assert.Contains("ReleaseIds = DataFeed.Application.App.Shared.EventCatalog.FredReleaseIdsCsv", program);
        Assert.DoesNotContain("\"10,50,46,53\"", program);
    }
    private class FredReleasesStub : IRequestHandler<FredReleaseDatesRequest, SourcedResponse<List<FredReleaseDateDto>>>
    {
        public string? ReleaseIds { get; private set; }
        public Task<SourcedResponse<List<FredReleaseDateDto>>> Handle(FredReleaseDatesRequest r, CancellationToken ct)
        {
            ReleaseIds = r.ReleaseIds;
            return Task.FromResult(new SourcedResponse<List<FredReleaseDateDto>> { Source = "fred", RetrievedAt = DateTime.UtcNow, AsOf = "2026-10-12", UpstreamUrl = "https://example.test", Data = new() });
        }
    }
    private class TreasuryStub : IRequestHandler<DataFeed.Application.Data.Treasury.TreasuryYieldCurveRequest,
        SourcedResponse<List<DataFeed.Application.Data.Treasury.TreasuryCurveDayDto>>>
    {
        public bool Fail { get; set; }
        public Task<SourcedResponse<List<DataFeed.Application.Data.Treasury.TreasuryCurveDayDto>>> Handle(
            DataFeed.Application.Data.Treasury.TreasuryYieldCurveRequest r, CancellationToken ct) => Fail
            ? throw new HttpRequestException("Synthetic failure, no network")
            : Task.FromResult(new SourcedResponse<List<DataFeed.Application.Data.Treasury.TreasuryCurveDayDto>> {
                Source = "treasury", RetrievedAt = DateTime.UtcNow, AsOf = "2026-10-12", UpstreamUrl = "https://example.test",
                Data = new() { new("2026-10-12", new Dictionary<string, decimal> { ["2Y"] = 4, ["5Y"] = 4.2m, ["10Y"] = 4.5m, ["30Y"] = 4.8m }) } });
    }
}
