using Newtonsoft.Json;

namespace DataFeed.Api.Controllers.Dtos
{
    /// <summary>
    /// Cuerpo de un error que el tablero tiene que poder DISTINGUIR, no solo mostrar.
    ///
    /// Existe por el <see cref="Code"/>: hay estados esperados —la cuenta sin vincular, el símbolo
    /// sin cadena de opciones— que salen con 409 y contra los que el front decide qué decir. Ese
    /// `code` es contrato, y hasta ahora viajaba adentro de un objeto anónimo de
    /// <see cref="DataFeed.Controllers.DataFeedControllerBase"/>: no tenía tipo que declarar, así
    /// que Swagger mostraba el 409 sin cuerpo y el contrato existía solo en la cabeza de quien lo
    /// escribió.
    ///
    /// **Los atributos son de Newtonsoft, no de System.Text.Json.** La API serializa sus respuestas
    /// con AddNewtonsoftJson (ver Program.cs), así que un [JsonPropertyName] de STJ acá sería
    /// decorativo — es exactamente al revés que en los modelos del proveedor Tastytrade, que se
    /// DESERIALIZAN con STJ.
    /// </summary>
    public class ApiErrorResponse
    {
        /// <summary>Mensaje legible. Es lo que se muestra cuando no hay nada mejor que decir.</summary>
        [JsonProperty("error")]
        public string Error { get; set; } = "";

        /// <summary>
        /// Identificador estable del estado: `broker_account_not_linked`, `broker_credential_invalid`,
        /// `option_chain_not_found`.
        /// **Renombrarlo rompe el mensaje del front**, que matchea contra esto y no contra el texto.
        /// </summary>
        [JsonProperty("code")]
        public string Code { get; set; } = "";

        /// <summary>
        /// El símbolo del que se habla, cuando el estado es de un símbolo. Se omite si no aplica:
        /// mandarlo en null cambiaría el cuerpo del 409 de la cuenta, que nunca lo tuvo.
        ///
        /// Un campo suelto y no una bolsa de detalles a propósito: lo que se agrega acá es lo que el
        /// front necesita para ARMAR el mensaje sin parsearlo, y eso se decide de a un caso.
        /// </summary>
        [JsonProperty("symbol", NullValueHandling = NullValueHandling.Ignore)]
        public string? Symbol { get; set; }
    }
}
