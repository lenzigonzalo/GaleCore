using MediatR;

namespace DataFeed.Application.Data.Tastytrade.AccountSpreads
{
    /// <summary>
    /// Las posiciones de la cuenta armadas como spreads, con sus números de riesgo calculados acá
    /// y no en el Monitor (WS-0036, «todo desde el back»).
    /// </summary>
    public class AccountSpreadsRequest : IRequest<AccountSpreadsResponse>
    {
        // Opcional: igual que en Positions, sin número se usa la cuenta del usuario o la de configuración.
        public string? AccountNumber { get; set; }
    }
}
