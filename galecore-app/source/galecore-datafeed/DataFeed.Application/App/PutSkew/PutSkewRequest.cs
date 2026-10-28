using MediatR;

namespace DataFeed.Application.App.PutSkew
{
    public class PutSkewRequest : IRequest<PutSkewResponse>
    {
        /// <summary>Símbolo del subyacente (ej: SPY, QQQ).</summary>
        public string Symbol { get; set; }

        /// <summary>Delta objetivo del put (magnitud). Default 0.25 → busca el put con delta ≈ -0.25.</summary>
        public double Delta { get; set; } = 0.25;

        /// <summary>Máximo DTE para filtrar expiraciones (default 60).</summary>
        public int MaxDTE { get; set; } = 60;
    }
}
