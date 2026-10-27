using System.Collections.Concurrent;

namespace DataFeed.Application.Shared;

/// <summary>
/// Una lectura por día (de Nueva York) y por clave, para fuentes que cambian a lo sumo una vez por día (calendarios
/// de FRED y de la Fed). Pedidos simultáneos comparten la misma lectura. Al cambiar el día se devuelve la del día
/// anterior al instante y se actualiza en segundo plano; si la fuente falla, queda la anterior con su fecha original.
/// </summary>
public static class DailyCache
{
    private record Entry(DateOnly Day, Task<object> Value, object? Previous = null);
    private static readonly ConcurrentDictionary<string, Entry> Entries = new();
    private static readonly TimeZoneInfo NewYork = TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "Eastern Standard Time" : "America/New_York");

    public static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, NewYork));

    public static async Task<T> GetAsync<T>(string key, Func<CancellationToken, Task<T>> read, CancellationToken ct) where T : class
    {
        var today = Today;
        if (Entries.TryGetValue(key, out var entry))
        {
            if (entry.Day == today)
                return entry.Previous != null && !entry.Value.IsCompletedSuccessfully ? (T)entry.Previous : (T)await Await(key, entry, read, ct);
            if (entry.Value.IsCompletedSuccessfully)
            {
                Refresh(key, entry, today, read);
                return (T)entry.Value.Result;
            }
        }
        var fresh = new Entry(today, Start(read, CancellationToken.None));
        var current = Entries.AddOrUpdate(key, fresh, (_, old) => old.Day == today ? old : fresh);
        return (T)await Await(key, current, read, ct);
    }

    private static async Task<object> Start<T>(Func<CancellationToken, Task<T>> read, CancellationToken ct) where T : class => await read(ct);

    private static async Task<object> Await<T>(string key, Entry entry, Func<CancellationToken, Task<T>> read, CancellationToken ct) where T : class
    {
        try { return await entry.Value.WaitAsync(ct); }
        catch when (!ct.IsCancellationRequested)
        {
            // Lectura fallida: no queda guardada, el próximo pedido vuelve a intentar.
            Entries.TryRemove(new KeyValuePair<string, Entry>(key, entry));
            throw;
        }
    }

    private static void Refresh<T>(string key, Entry stale, DateOnly today, Func<CancellationToken, Task<T>> read) where T : class
    {
        var next = new Entry(today, Start(read, CancellationToken.None), stale.Value.Result);
        if (!Entries.TryUpdate(key, next, stale)) return;
        next.Value.ContinueWith(t => Entries.TryUpdate(key, stale, next), TaskContinuationOptions.NotOnRanToCompletion);
    }
}
