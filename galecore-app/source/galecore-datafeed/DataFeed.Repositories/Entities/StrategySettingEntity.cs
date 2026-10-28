namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Etapa y modo de una estrategia (WS-0036, decisión del owner 14/10): etapa SHADOW → PAPER → LIVE y modo
    /// AUTO (corre sola) / MANUAL (avisa y el trader entra y gestiona). Una fila por estrategia; sin fila valen los
    /// valores por defecto de <c>StrategySettings.Default</c>. Etapa y modo están también como CHECK en la base.
    /// </summary>
    public class StrategySettingEntity
    {
        public static readonly string[] Stages = { "SHADOW", "PAPER", "LIVE" };
        public static readonly string[] Modes = { "AUTO", "MANUAL" };

        /// <summary>Nombre de la estrategia: el de la spec del runtime o «rpf».</summary>
        public string Name { get; set; } = "";
        public string Stage { get; set; } = "SHADOW";
        public string Mode { get; set; } = "AUTO";
        public string UpdatedBy { get; set; } = "";
        public DateTime UpdatedAt { get; set; }
    }
}
