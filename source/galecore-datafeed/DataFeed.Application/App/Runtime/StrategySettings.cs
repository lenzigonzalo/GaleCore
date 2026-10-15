namespace DataFeed.Application.App.Runtime
{
    /// <summary>Etapa y modo de una estrategia, como los ve la interfaz.</summary>
    public record StrategySetting
    {
        public string Name { get; init; } = "";
        /// <summary>SHADOW | PAPER | LIVE.</summary>
        public string Stage { get; init; } = "SHADOW";
        /// <summary>AUTO | MANUAL.</summary>
        public string Mode { get; init; } = "AUTO";
        /// <summary>true si sale del valor por defecto (nadie lo eligió todavía).</summary>
        public bool IsDefault { get; init; }
        /// <summary>Qué hace hoy esa combinación, en una frase (lo que todavía no existe se dice).</summary>
        public string Effect { get; init; } = "";
        public string? UpdatedBy { get; init; }
        public DateTime? UpdatedAt { get; init; }
    }

    /// <summary>
    /// Reglas de etapa y modo (WS-0036, owner 14/10). Función pura: los valores por defecto, qué combinación se puede
    /// guardar y qué hace hoy cada una. LIVE·AUTO mandaría órdenes solas: queda rechazada hasta que exista la ejecución
    /// (U-62) y el owner la apruebe; ejecutar sigue pasando por la Mesa con confirmación.
    /// </summary>
    public static class StrategySettings
    {
        public static readonly string[] Stages = { "SHADOW", "PAPER", "LIVE" };
        public static readonly string[] Modes = { "AUTO", "MANUAL" };

        /// <summary>RPF es legacy (no validada): LIVE·MANUAL. Las del runtime: SHADOW·AUTO.</summary>
        public static (string Stage, string Mode) Default(string name) =>
            name == "rpf" ? ("LIVE", "MANUAL") : ("SHADOW", "AUTO");

        /// <summary>Por qué no se puede guardar, o null si se puede.</summary>
        public static string? Problem(string stage, string mode)
        {
            if (!Stages.Contains(stage)) return $"etapa es una de: {string.Join(", ", Stages)}";
            if (!Modes.Contains(mode)) return $"modo es uno de: {string.Join(", ", Modes)}";
            if (stage == "SHADOW" && mode == "MANUAL")
                return "SHADOW corre siempre en automático: es el banco de pruebas de la estrategia.";
            if (stage == "LIVE" && mode == "AUTO")
                return "LIVE en automático mandaría órdenes reales solas: bloqueado hasta que exista la ejecución y lo apruebes.";
            return null;
        }

        public static string Effect(string stage, string mode) => (stage, mode) switch
        {
            ("SHADOW", "AUTO") => "Corre sola con fills simulados.",
            ("PAPER", _) => "Necesita la cuenta paper del bróker, que todavía no está conectada.",
            ("LIVE", "MANUAL") => "Avisa y vos operás en tu cuenta.",
            _ => "Bloqueado.",
        };

        /// <summary>Una fila por nombre pedido: la guardada o la de por defecto.</summary>
        public static List<StrategySetting> Resolve(IEnumerable<string> names,
            IReadOnlyDictionary<string, (string Stage, string Mode, string UpdatedBy, DateTime UpdatedAt)> saved) =>
            names.Distinct().OrderBy(n => n).Select(name =>
            {
                if (saved.TryGetValue(name, out var row))
                    return new StrategySetting { Name = name, Stage = row.Stage, Mode = row.Mode, Effect = Effect(row.Stage, row.Mode),
                        UpdatedBy = row.UpdatedBy, UpdatedAt = row.UpdatedAt };
                var (stage, mode) = Default(name);
                return new StrategySetting { Name = name, Stage = stage, Mode = mode, IsDefault = true, Effect = Effect(stage, mode) };
            }).ToList();
    }
}
