namespace DataFeed.Api.Controllers.Dtos
{
    /// <summary>Una pieza del espacio del trader (GC-0007). El tipo y la clave van en la ruta; el dueño sale del token.</summary>
    public class TraderSpaceItemRequest
    {
        public string? Title { get; set; }

        /// <summary>Texto en markdown, o JSON si <see cref="Format"/> es <c>json</c>.</summary>
        public string? Content { get; set; }

        /// <summary><c>markdown</c> (por defecto) o <c>json</c>.</summary>
        public string? Format { get; set; }

        /// <summary><c>private</c> (por defecto) o <c>shared</c>: el resto del equipo la ve, no la edita.</summary>
        public string? Visibility { get; set; }
    }
}
