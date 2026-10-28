namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Una pieza del espacio del trader (GC-0007): su perfil, un objetivo, una convención, algo de su memoria, una
    /// skill, un agente, un dato que pone a disposición, una preferencia de la interfaz (watchlist, paneles; WS-0036) o una idea (ítem del buzón, faltante o feedback, compartida entre usuarios). Es de su dueño; si es <c>shared</c>, el resto del equipo la ve
    /// (y no la edita). GaleCore-AI la carga al iniciar cada sesión para responder según los objetivos del trader.
    ///
    /// Una sola tabla genérica a propósito: el contenido es texto (markdown o JSON) que escribe el trader o
    /// GaleCore-AI, y GaleCore no lo interpreta, salvo dos lecturas acotadas: `preference/aviso-strike` y los topes de
    /// `profile/perfil` en el resumen de la cuenta (WS-0043). Si un tipo necesita estructura propia, se separa.
    /// </summary>
    public class TraderSpaceItem
    {
        public static readonly string[] Kinds = { "profile", "objective", "convention", "memory", "skill", "agent", "data", "preference", "idea" };
        public static readonly string[] Visibilities = { "private", "shared" };
        public static readonly string[] Formats = { "markdown", "json" };
        public const string KeyPattern = "^[a-z0-9][a-z0-9._-]{0,63}$";

        public Guid Id { get; set; }
        public Guid OwnerId { get; set; }
        public User Owner { get; set; } = null!;
        public string Kind { get; set; } = "";
        /// <summary>Identificador estable dentro de su tipo (ej: <c>oportunidades</c>, <c>riesgo-por-operacion</c>).</summary>
        public string Key { get; set; } = "";
        public string Title { get; set; } = "";
        public string Content { get; set; } = "";
        public string Format { get; set; } = "markdown";
        public string Visibility { get; set; } = "private";
        /// <summary>Sube con cada cambio de contenido: GaleCore-AI cita la versión que usó.</summary>
        public int Version { get; set; } = 1;
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }

        public const int MaxContentLength = 200_000;

        /// <summary>Por qué una pieza no se puede guardar, o null si se puede. La misma regla que los CHECK de la base.</summary>
        public static string? Validate(string kind, string key, string title, string content, string format, string visibility)
        {
            if (!Kinds.Contains(kind)) return $"kind es uno de: {string.Join(", ", Kinds)}";
            if (!System.Text.RegularExpressions.Regex.IsMatch(key ?? "", KeyPattern))
                return "key: minúsculas, números, punto, guion o guion bajo (hasta 64)";
            if (string.IsNullOrWhiteSpace(title) || title.Length > 200) return "title es requerido (hasta 200 caracteres)";
            if (content == null || content.Length > MaxContentLength) return $"content es requerido (hasta {MaxContentLength} caracteres)";
            if (!Formats.Contains(format)) return $"format es uno de: {string.Join(", ", Formats)}";
            if (!Visibilities.Contains(visibility)) return $"visibility es una de: {string.Join(", ", Visibilities)}";
            if (format == "json")
            {
                try { System.Text.Json.JsonDocument.Parse(content).Dispose(); }
                catch (System.Text.Json.JsonException) { return "content no es JSON válido"; }
            }
            return null;
        }
    }
}
