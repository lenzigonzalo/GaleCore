namespace DataFeed.Api.Controllers.Dtos
{
    /// <summary>Crea un proyecto compartido (WS-0064). El dueño sale del token.</summary>
    public class SharedProjectRequest
    {
        public string? Name { get; set; }
        /// <summary><c>workspace</c> o <c>strategy</c>.</summary>
        public string? Kind { get; set; }
        /// <summary>Nombre de la carpeta del proyecto en la PC del dueño.</summary>
        public string? LocalKey { get; set; }
    }

    public class SharedProjectMemberRequest
    {
        public string? Username { get; set; }
    }

    /// <summary>Un cambio a un archivo del proyecto. El hash del contenido lo calcula el servidor.</summary>
    public class SharedProjectChangeRequest
    {
        /// <summary>Ruta relativa POSIX dentro del proyecto.</summary>
        public string? Path { get; set; }
        /// <summary><c>put</c> o <c>delete</c>.</summary>
        public string? Op { get; set; }
        /// <summary><c>utf8</c> o <c>base64</c> (sólo en un put).</summary>
        public string? Encoding { get; set; }
        public string? Content { get; set; }
        /// <summary>Hash del que partió la copia del autor; null = archivo nuevo.</summary>
        public string? BaseHash { get; set; }
    }
}
