using System.Threading.Tasks;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    public interface ITastytradeOAuth
    {
        /// <summary>
        /// Request autenticado con la credencial de SISTEMA (datos de mercado). Es la sobrecarga que
        /// usan los ~14 consumidores de mercado y los procesos de fondo, que no tienen usuario.
        /// </summary>
        Task<HttpRequestMessage> CreateOAuthApiRequestAsync(string endpoint);

        /// <summary>
        /// Request autenticado con una credencial concreta. Es la que usan los datos de CUENTA
        /// (balances, posiciones), donde el token tiene que ser el del usuario que pregunta.
        /// </summary>
        Task<HttpRequestMessage> CreateOAuthApiRequestAsync(string endpoint, TastytradeCredential credential);

        /// <summary>
        /// Token de WebSocket para DXLink, siempre con la credencial de sistema: el feed de mercado
        /// es uno solo y compartido — abrir una sesión DXLink por usuario multiplicaría el consumo
        /// del presupuesto de suscripción sin ganar nada (SPY es SPY para todos).
        /// </summary>
        Task<OAuthResponseWSModel> GetWsOAuthApiAsync();
    }
}
