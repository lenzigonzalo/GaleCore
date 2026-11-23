namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Un bróker del usuario en la cartera consolidada (WS-0108): si entra en ella (<see cref="IncludeInPortfolio"/>), su
    /// credencial cifrada cuando la plataforma la guarda (IOL) y el resultado de la última prueba. Tastytrade sigue con su
    /// credencial en <c>accounts</c>: acá sólo su interruptor y la última prueba (fila sin secreto).
    /// </summary>
    public class UserBroker
    {
        /// <summary>uuid del usuario. Sin FK a propósito, como <see cref="PlatformConnection"/>.</summary>
        public Guid UserId { get; set; }

        /// <summary>"tastytrade" | "ibkr" | "iol".</summary>
        public string Broker { get; set; } = "";

        public bool IncludeInPortfolio { get; set; } = true;

        /// <summary>JSON CIFRADO con <c>ITokenProtector</c> (IOL = {username,password}). Null = sin credencial propia.</summary>
        public string? SecretCipher { get; set; }

        /// <summary>«••1a2b»: últimos 4 del usuario de IOL, sólo si tiene 8 o más caracteres.</summary>
        public string? SecretHint { get; set; }

        public DateTime UpdatedAt { get; set; }

        public DateTime? LastCheckAt { get; set; }
        public bool? LastCheckOk { get; set; }
        public string? LastCheckMessage { get; set; }
    }
}
