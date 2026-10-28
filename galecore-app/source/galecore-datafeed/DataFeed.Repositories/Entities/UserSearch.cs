namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Búsqueda mínima de usuarios para sugerir a quién compartir un proyecto (WS-0064). Sólo devuelve usuario y nombre:
    /// nunca el mail ni otro dato. Función sobre IQueryable para poder probarla sin base.
    /// </summary>
    public static class UserSearch
    {
        public const int MinLength = 2;
        public const int MaxResults = 10;

        public static string? Normalize(string? q)
        {
            var t = (q ?? string.Empty).Trim().ToLowerInvariant();
            return t.Length < MinLength || t.Length > 64 ? null : t;
        }

        /// <summary>Usuarios cuyo usuario o nombre contiene <paramref name="q"/> (sin mayúsculas), sin quien consulta.
        /// Primero los que empiezan con el texto, después por usuario. Tope de 10.</summary>
        public static List<(string Username, string? DisplayName)> Find(IQueryable<User> users, string q, Guid callerId)
        {
            var rows = users.Where(u => u.Id != callerId
                    && (u.Username.ToLower().Contains(q) || (u.DisplayName != null && u.DisplayName.ToLower().Contains(q))))
                .OrderByDescending(u => u.Username.ToLower().StartsWith(q))
                .ThenBy(u => u.Username)
                .Take(MaxResults)
                .Select(u => new { u.Username, u.DisplayName })
                .ToList();
            return rows.Select(r => (r.Username, r.DisplayName)).ToList();
        }
    }
}
