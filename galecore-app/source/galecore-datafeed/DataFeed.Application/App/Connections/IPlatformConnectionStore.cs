using DataFeed.Repositories;
using DataFeed.Repositories.Entities;
using Microsoft.EntityFrameworkCore;

namespace DataFeed.Application.App.Connections
{
    /// <summary>Fila de <c>platform_connections</c> más el nombre de quien la cambió (si se encontró).</summary>
    public sealed record PlatformConnectionRow(
        string ConnectionId, string? SecretCipher, string? SecretHint, DateTime? UpdatedAt, Guid? UpdatedBy,
        string? UpdatedByName, DateTime? LastTestAt, bool? LastTestOk, string? LastTestMessage);

    /// <summary>Acceso a la tabla; existe para poder probar el servicio sin base.</summary>
    public interface IPlatformConnectionStore
    {
        Task<IReadOnlyList<PlatformConnectionRow>> LoadAllAsync(CancellationToken ct);

        /// <summary>Guarda valor cifrado, hint, autor y limpia el resultado de la última prueba.</summary>
        Task UpsertSecretAsync(string id, string cipher, string? hint, Guid? updatedBy, DateTime now, CancellationToken ct);

        Task DeleteAsync(string id, CancellationToken ct);

        Task SaveTestAsync(string id, DateTime at, bool ok, string message, CancellationToken ct);

        /// <summary>¿El usuario tiene una cuenta de bróker vinculada (estado de la entrada tastytrade)?</summary>
        Task<bool> HasBrokerAccountAsync(Guid userId, CancellationToken ct);
    }

    public sealed class EfPlatformConnectionStore : IPlatformConnectionStore
    {
        private readonly Func<GaleCoreDbContext> _newContext;

        public EfPlatformConnectionStore(Func<GaleCoreDbContext> newContext) => _newContext = newContext;

        public async Task<IReadOnlyList<PlatformConnectionRow>> LoadAllAsync(CancellationToken ct)
        {
            await using var db = _newContext();
            var rows = await db.PlatformConnections.AsNoTracking().ToListAsync(ct);
            var authors = rows.Where(r => r.UpdatedBy != null).Select(r => r.UpdatedBy!.Value).Distinct().ToList();
            var names = authors.Count == 0
                ? new Dictionary<Guid, string>()
                : await db.Users.AsNoTracking().Where(u => authors.Contains(u.Id))
                    .ToDictionaryAsync(u => u.Id, u => u.DisplayName ?? u.Username, ct);
            return rows.Select(r => new PlatformConnectionRow(
                r.ConnectionId, r.SecretCipher, r.SecretHint, r.UpdatedAt, r.UpdatedBy,
                r.UpdatedBy != null && names.TryGetValue(r.UpdatedBy.Value, out var n) ? n : null,
                r.LastTestAt, r.LastTestOk, r.LastTestMessage)).ToList();
        }

        public async Task UpsertSecretAsync(string id, string cipher, string? hint, Guid? updatedBy, DateTime now, CancellationToken ct)
        {
            await using var db = _newContext();
            var row = await db.PlatformConnections.FirstOrDefaultAsync(x => x.ConnectionId == id, ct);
            if (row == null) { row = new PlatformConnection { ConnectionId = id }; db.PlatformConnections.Add(row); }
            row.SecretCipher = cipher;
            row.SecretHint = hint;
            row.UpdatedAt = now;
            row.UpdatedBy = updatedBy;
            row.LastTestAt = null;
            row.LastTestOk = null;
            row.LastTestMessage = null;
            await db.SaveChangesAsync(ct);
        }

        public async Task DeleteAsync(string id, CancellationToken ct)
        {
            await using var db = _newContext();
            var row = await db.PlatformConnections.FirstOrDefaultAsync(x => x.ConnectionId == id, ct);
            if (row == null) return;
            db.PlatformConnections.Remove(row);
            await db.SaveChangesAsync(ct);
        }

        public async Task SaveTestAsync(string id, DateTime at, bool ok, string message, CancellationToken ct)
        {
            await using var db = _newContext();
            var row = await db.PlatformConnections.FirstOrDefaultAsync(x => x.ConnectionId == id, ct);
            if (row == null) { row = new PlatformConnection { ConnectionId = id }; db.PlatformConnections.Add(row); }
            row.LastTestAt = at;
            row.LastTestOk = ok;
            row.LastTestMessage = message.Length > 500 ? message[..500] : message;
            await db.SaveChangesAsync(ct);
        }

        public async Task<bool> HasBrokerAccountAsync(Guid userId, CancellationToken ct)
        {
            await using var db = _newContext();
            return await db.Accounts.AsNoTracking().AnyAsync(a => a.UserId == userId, ct);
        }
    }
}
