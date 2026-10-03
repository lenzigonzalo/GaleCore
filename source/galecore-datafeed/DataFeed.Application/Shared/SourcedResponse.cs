namespace DataFeed.Application.Shared
{
    /// <summary>
    /// Datos de una fuente externa con su procedencia (contrato de fuentes, GC-0006): de dónde salieron (URL sin
    /// clave), cuándo se leyeron y qué hay que saber al usarlos.
    /// </summary>
    public class SourcedResponse<T>
    {
        public string Source { get; set; } = "";
        public string UpstreamUrl { get; set; } = "";
        public DateTime RetrievedAt { get; set; }
        public bool FromCache { get; set; }
        public string AsOf { get; set; } = "";
        public string? Sha256 { get; set; }
        public List<string> Notes { get; set; } = new();
        public T Data { get; set; } = default!;
    }
}
