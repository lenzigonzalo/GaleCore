using DataFeed.Repositories;
using DataFeed.Repositories.Entities;
using Microsoft.EntityFrameworkCore;

namespace DataFeed.Application.App.Brokers
{
    /// <summary>Fila de <c>user_brokers</c> del usuario. Nunca sale de la capa de servicio con el cifrado a la vista.</summary>
    public sealed record UserBrokerRow(
        string Broker, bool Include, string? SecretCipher, string? SecretHint,
        DateTime? LastCheckAt, bool? LastCheckOk, string? LastCheckMessage);

    /// <summary>Acceso a <c>user_brokers</c> y a <c>accounts</c>; existe para poder probar el servicio sin base.</summary>
    public interface IBrokerStore
    {
        Task<IReadOnlyList<UserBrokerRow>> LoadAsync(Guid userId, CancellationToken ct);

        /// <summary>¿El usuario tiene una cuenta de Tastytrade vinculada (fila en <c>accounts</c>)?</summary>
        Task<bool> HasTastytradeAccountAsync(Guid userId, CancellationToken ct);

        /// <summary>Guarda credencial cifrada y hint, y limpia el resultado de la última prueba. No toca el interruptor.</summary>
        Task SaveSecretAsync(Guid userId, string broker, string cipher, string? hint, DateTime now, CancellationToken ct);

        /// <summary>Borra credencial, hint y última prueba; la fila (y su interruptor) queda.</summary>
        Task ClearSecretAsync(Guid userId, string broker, DateTime now, CancellationToken ct);

        Task SetIncludeAsync(Guid userId, string broker, bool include, DateTime now, CancellationToken ct);

        Task SaveCheckAsync(Guid userId, string broker, DateTime at, bool ok, string message, CancellationToken ct);
    }

    public sealed class EfBrokerStore : IBrokerStore
    {
        private readonly Func<GaleCoreDbContext> _newContext;

        public EfBrokerStore(Func<GaleCoreDbContext> newContext) => _newContext = newContext;

        public async Task<IReadOnlyList<UserBrokerRow>> LoadAsync(Guid userId, CancellationToken ct)
        {
            await using var db = _newContext();
            return await db.UserBrokers.AsNoTracking().Where(x => x.UserId == userId)
                .Select(x => new UserBrokerRow(x.Broker, x.IncludeInPortfolio, x.SecretCipher, x.SecretHint,
                    x.LastCheckAt, x.LastCheckOk, x.LastCheckMessage))
                .ToListAsync(ct);
        }

        public async Task<bool> HasTastytradeAccountAsync(Guid userId, CancellationToken ct)
        {
            await using var db = _newContext();
            return await db.Accounts.AsNoTracking().AnyAsync(a => a.UserId == userId, ct);
        }

        public Task SaveSecretAsync(Guid userId, string broker, string cipher, string? hint, DateTime now, CancellationToken ct) =>
            MutateAsync(userId, broker, now, row =>
            {
                row.SecretCipher = cipher;
                row.SecretHint = hint;
                row.LastCheckAt = null;
                row.LastCheckOk = null;
                row.LastCheckMessage = null;
            }, ct);

        public Task ClearSecretAsync(Guid userId, string broker, DateTime now, CancellationToken ct) =>
            MutateAsync(userId, broker, now, row =>
            {
                row.SecretCipher = null;
                row.SecretHint = null;
                row.LastCheckAt = null;
                row.LastCheckOk = null;
                row.LastCheckMessage = null;
            }, ct);

        public Task SetIncludeAsync(Guid userId, string broker, bool include, DateTime now, CancellationToken ct) =>
            MutateAsync(userId, broker, now, row => row.IncludeInPortfolio = include, ct);

        public Task SaveCheckAsync(Guid userId, string broker, DateTime at, bool ok, string message, CancellationToken ct) =>
            MutateAsync(userId, broker, at, row =>
            {
                row.LastCheckAt = at;
                row.LastCheckOk = ok;
                row.LastCheckMessage = message.Length > 500 ? message[..500] : message;
            }, ct);

        private async Task MutateAsync(Guid userId, string broker, DateTime now, Action<UserBroker> change, CancellationToken ct)
        {
            await using var db = _newContext();
            var row = await db.UserBrokers.FirstOrDefaultAsync(x => x.UserId == userId && x.Broker == broker, ct);
            if (row == null)
            {
                row = new UserBroker { UserId = userId, Broker = broker, IncludeInPortfolio = true };
                db.UserBrokers.Add(row);
            }
            change(row);
            row.UpdatedAt = now;
            await db.SaveChangesAsync(ct);
        }
    }
}
