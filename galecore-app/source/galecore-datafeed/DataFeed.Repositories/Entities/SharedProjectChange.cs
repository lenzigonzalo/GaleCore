using System.Security.Cryptography;

namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Un cambio a un archivo de un proyecto compartido (WS-0064 Fase 2a). Es un registro append-only: <see cref="Seq"/>
    /// es global y creciente, y es el cursor de sincronización de cada PC («dame lo posterior a N»). El estado de un
    /// archivo es su último cambio; el contenido viaja en <see cref="Content"/> (texto, o base64 si es binario).
    /// </summary>
    public class SharedProjectChange
    {
        public static readonly string[] Ops = { "put", "delete" };
        public static readonly string[] Encodings = { "utf8", "base64" };
        public const int MaxPathLength = 400;
        /// <summary>Tope del contenido ya decodificado.</summary>
        public const int MaxContentBytes = 2 * 1024 * 1024;
        public const int PageSize = 500;

        public long Seq { get; set; }
        public Guid ProjectId { get; set; }
        public SharedProject Project { get; set; } = null!;
        public Guid AuthorId { get; set; }
        public User Author { get; set; } = null!;
        /// <summary>Ruta relativa POSIX dentro del proyecto.</summary>
        public string Path { get; set; } = "";
        public string Op { get; set; } = "put";
        public string Encoding { get; set; } = "utf8";
        public string? Content { get; set; }
        /// <summary>sha256 hex del contenido decodificado; null en un delete. Lo calcula el servidor.</summary>
        public string? ContentHash { get; set; }
        /// <summary>Hash del que partió la copia del autor; null = archivo nuevo.</summary>
        public string? BaseHash { get; set; }
        public DateTime CreatedAt { get; set; }

        /// <summary>Por qué una ruta no es válida, o null si lo es: relativa, POSIX, sin «..», hasta 400.</summary>
        public static string? ValidatePath(string? path)
        {
            if (string.IsNullOrEmpty(path) || path.Length > MaxPathLength) return $"path es requerido (hasta {MaxPathLength} caracteres)";
            if (path.StartsWith('/')) return "path es relativo: no puede empezar con '/'";
            if (path.Contains('\\')) return "path usa '/' como separador: no admite barra invertida";
            if (path.Any(char.IsControl)) return "path no admite caracteres de control";
            var parts = path.Split('/');
            if (parts.Any(p => p.Length == 0)) return "path no puede tener segmentos vacíos";
            if (parts.Any(p => p == ".." || p == ".")) return "path no puede contener '.' ni '..'";
            return null;
        }

        /// <summary>
        /// Valida el cambio y calcula su hash. Devuelve el motivo del rechazo (o null) y el hash del contenido decodificado
        /// (null en un delete). El hash nunca viene del cliente.
        /// </summary>
        public static (string? Error, string? Hash) ValidateAndHash(string? path, string? op, string? encoding, string? content)
        {
            var pathError = ValidatePath(path);
            if (pathError != null) return (pathError, null);
            if (op == null || !Ops.Contains(op)) return ($"op es uno de: {string.Join(", ", Ops)}", null);
            if (op == "delete") return (null, null);
            if (encoding == null || !Encodings.Contains(encoding)) return ($"encoding es uno de: {string.Join(", ", Encodings)}", null);
            if (content == null) return ("content es requerido en un put", null);
            var tooBig = ($"content supera {MaxContentBytes / 1024 / 1024} MB", (string?)null);
            byte[] bytes;
            if (encoding == "utf8")
            {
                // Chequeo previo barato: UTF-8 ocupa como máximo 3 bytes por unidad UTF-16.
                if (content.Length > MaxContentBytes * 3) return tooBig;
                bytes = System.Text.Encoding.UTF8.GetBytes(content);
            }
            else
            {
                if (content.Length > MaxContentBytes / 3 * 4 + 8) return tooBig;
                try { bytes = Convert.FromBase64String(content); }
                catch (FormatException) { return ("content no es base64 válido", null); }
            }
            if (bytes.Length > MaxContentBytes) return tooBig;
            return (null, Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
        }

        public enum Outcome { Accept, NoOp, Conflict }

        /// <summary>
        /// La regla de conflicto, con <paramref name="latest"/> = el último cambio de esa ruta en el proyecto.
        /// Un put con el mismo hash que el último put no cambia nada (NoOp, aunque su base esté vieja: converge).
        /// Sin último, o último delete: sólo se acepta un archivo nuevo (baseHash null). Último put: hay que partir de
        /// su hash exacto (baseHash null = alguien creó el mismo archivo antes, o con otro contenido: conflicto).
        /// </summary>
        public static Outcome Decide(SharedProjectChange? latest, string op, string? newHash, string? baseHash)
        {
            if (latest == null || latest.Op == "delete")
                return baseHash == null ? Outcome.Accept : Outcome.Conflict;
            if (op == "put" && newHash == latest.ContentHash) return Outcome.NoOp;
            return baseHash != null && baseHash == latest.ContentHash ? Outcome.Accept : Outcome.Conflict;
        }
    }
}
