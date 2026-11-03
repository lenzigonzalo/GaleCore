namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Valor de una conexión de la PLATAFORMA (FRED, BLS, SEC) cargado desde la pantalla, más el resultado de la
    /// última prueba (WS-0080). Sin <c>user_id</c>: las conexiones personales viven en su propio lugar (bróker en
    /// <c>accounts</c>, conectores MCP en el motor).
    ///
    /// Una fila sin <see cref="SecretCipher"/> sólo guarda el resultado de una prueba hecha sobre el valor del
    /// servidor; no pisa nada.
    /// </summary>
    public class PlatformConnection
    {
        /// <summary>Id del catálogo: "fred", "bls", "sec".</summary>
        public string ConnectionId { get; set; } = "";

        /// <summary>Valor CIFRADO (AES-GCM, el mismo <c>ITokenProtector</c> que <c>accounts</c>). Null = sin valor propio.</summary>
        public string? SecretCipher { get; set; }

        /// <summary>«••1a2b»: últimos 4 caracteres, sólo si el valor tiene 8 o más.</summary>
        public string? SecretHint { get; set; }

        public DateTime? UpdatedAt { get; set; }

        /// <summary>uuid del usuario que lo cambió. Sin FK a propósito: borrar al usuario no toca la conexión.</summary>
        public Guid? UpdatedBy { get; set; }

        public DateTime? LastTestAt { get; set; }
        public bool? LastTestOk { get; set; }
        public string? LastTestMessage { get; set; }
    }
}
