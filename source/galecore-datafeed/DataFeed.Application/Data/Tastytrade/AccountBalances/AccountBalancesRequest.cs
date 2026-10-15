using MediatR;

namespace DataFeed.Application.Data.Tastytrade.AccountBalances
{
    public class AccountBalancesRequest : IRequest<AccountBalancesResponse>
    {
        // Opcional: si no se envía, se usa el número de cuenta de configuración
        public string? AccountNumber { get; set; }
        /// <summary>Sumar la historia del valor de la cuenta (último año), para el resultado por períodos.</summary>
        public bool WithHistory { get; set; }
    }
}
