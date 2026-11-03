namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Un proyecto compartido (WS-0064 Fase 2a). Cada usuario guarda sus proyectos en su PC; compartir es opt-in por
    /// proyecto y la API sólo intercambia cambios entre miembros (ver <see cref="SharedProjectChange"/>). No guarda el
    /// proyecto entero: sólo qué carpeta local es (<see cref="LocalKey"/>) y quién participa.
    /// </summary>
    public class SharedProject
    {
        public static readonly string[] Kinds = { "workspace", "strategy" };
        /// <summary><c>restricted</c>: sólo los miembros; <c>everyone</c>: cualquier usuario lo ve y se puede sumar (WS-0056).</summary>
        public static readonly string[] Accesses = { "restricted", "everyone" };
        public const int MaxNameLength = 200;
        public const int MaxLocalKeyLength = 200;

        public Guid Id { get; set; }
        public Guid OwnerId { get; set; }
        public User Owner { get; set; } = null!;
        public string Name { get; set; } = "";
        public string Kind { get; set; } = "workspace";
        /// <summary>Nombre de la carpeta del proyecto en la PC de quien lo creó.</summary>
        public string LocalKey { get; set; } = "";
        public string Access { get; set; } = "restricted";
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public List<SharedProjectMember> Members { get; set; } = new();

        /// <summary>Por qué un valor de acceso no vale, o null si vale.</summary>
        public static string? ValidateAccess(string? access)
            => access != null && Accesses.Contains(access) ? null : $"access es uno de: {string.Join(", ", Accesses)}";

        /// <summary>Por qué un proyecto no se puede crear, o null si se puede. Las mismas reglas que los CHECK de la base.</summary>
        public static string? Validate(string? name, string? kind, string? localKey)
        {
            if (string.IsNullOrWhiteSpace(name) || name.Length > MaxNameLength) return $"name es requerido (hasta {MaxNameLength} caracteres)";
            if (kind == null || !Kinds.Contains(kind)) return $"kind es uno de: {string.Join(", ", Kinds)}";
            if (string.IsNullOrWhiteSpace(localKey) || localKey.Length > MaxLocalKeyLength) return $"localKey es requerido (hasta {MaxLocalKeyLength} caracteres)";
            return null;
        }
    }

    public class SharedProjectMember
    {
        public static readonly string[] Roles = { "owner", "member" };

        public Guid ProjectId { get; set; }
        public SharedProject Project { get; set; } = null!;
        public Guid UserId { get; set; }
        public User User { get; set; } = null!;
        public string Role { get; set; } = "member";
        public DateTime AddedAt { get; set; }
    }
}
