namespace DataFeed.Infrastructure.Providers
{
    /// <summary>
    /// Una fuente externa (FRED, la Fed…) no respondió o cambió de forma. Sale como 502 con su motivo: nunca una lista
    /// vacía que se lea como «no hay eventos» (contrato de fuentes, GC-0006).
    /// </summary>
    public sealed class UpstreamSourceException : Exception
    {
        public const string Code = "UPSTREAM_SOURCE_UNAVAILABLE";

        public string Source { get; }

        public UpstreamSourceException(string source, string message) : base($"{source}: {message}")
        {
            Source = source;
        }
    }
}
