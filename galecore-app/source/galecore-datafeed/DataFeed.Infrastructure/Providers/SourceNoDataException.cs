namespace DataFeed.Infrastructure.Providers
{
    /// <summary>
    /// La fuente respondió bien pero no tiene ese dato (p. ej. la SEC 404 en un concepto XBRL que la empresa no reporta).
    /// Sale como 404 con su motivo: es falta de dato, no una fuente caída (BF-0016).
    /// </summary>
    public sealed class SourceNoDataException : Exception
    {
        public const string Code = "SOURCE_NO_DATA";

        public string Source { get; }

        public SourceNoDataException(string source, string message) : base($"{source}: {message}")
        {
            Source = source;
        }
    }
}
