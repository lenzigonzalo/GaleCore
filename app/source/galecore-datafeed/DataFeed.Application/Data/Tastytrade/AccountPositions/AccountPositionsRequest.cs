using MediatR;

namespace DataFeed.Application.Data.Tastytrade.AccountPositions
{
    public class AccountPositionsRequest : IRequest<AccountPositionsResponse>
    {
        // Opcional: si no se envía, se usa el número de cuenta de configuración
        public string? AccountNumber { get; set; }
    }
}
