namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Spec cargado y hasheado. Inmutable: un cambio al contenido produce un nuevo hash y una nueva fila.
    /// </summary>
    public class StrategySpecEntity
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = "";
        public string DisplayName { get; set; } = "";
        public string Version { get; set; } = "";
        /// <summary>SHA-256 canónico (RFC 8785 JCS). Identidad criptográfica del contenido.</summary>
        public string ContentHash { get; set; } = "";
        /// <summary>JSON completo del spec, guardado para reconstrucción.</summary>
        public string SpecJson { get; set; } = "";
        public DateTime CreatedAt { get; set; }
    }
}
