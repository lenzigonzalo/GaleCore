using DataFeed.Repositories;
using DataFeed.Repositories.Entities;
using Microsoft.EntityFrameworkCore;

namespace DataFeed.Application.App.Agents
{
    public sealed record AgentKeyRow(Guid OwnerId, string KeyHash, string KeyHint, DateTime CreatedAt);

    public sealed record AgentFireTokenRow(
        Guid OwnerId, string AgentKey, string TriggerId, string TokenCipher, string TokenHint, DateTime UpdatedAt, DateTime? LastFiredAt);

    /// <summary>Acceso a las tablas de agentes (WS-0079); existe para probar el servicio sin base.</summary>
    public interface IAgentStore
    {
        Task<AgentKeyRow?> GetKeyByOwnerAsync(Guid ownerId, CancellationToken ct);
        Task<AgentKeyRow?> GetKeyByHashAsync(string keyHash, CancellationToken ct);
        /// <summary>Crea o reemplaza la clave del usuario (regenerar invalida la anterior).</summary>
        Task UpsertKeyAsync(Guid ownerId, string keyHash, string keyHint, DateTime now, CancellationToken ct);
        Task<bool> DeleteKeyAsync(Guid ownerId, CancellationToken ct);

        /// <summary>¿El usuario tiene un ítem <c>agent</c> con esa clave en su espacio?</summary>
        Task<bool> AgentExistsAsync(Guid ownerId, string agentKey, CancellationToken ct);

        Task<AgentFireTokenRow?> GetFireTokenAsync(Guid ownerId, string agentKey, CancellationToken ct);
        /// <summary>Guarda trigger y token cifrado; limpia el último disparo.</summary>
        Task UpsertFireTokenAsync(Guid ownerId, string agentKey, string triggerId, string cipher, string hint, DateTime now, CancellationToken ct);
        Task<bool> DeleteFireTokenAsync(Guid ownerId, string agentKey, CancellationToken ct);
        Task MarkFiredAsync(Guid ownerId, string agentKey, DateTime at, CancellationToken ct);

        Task<AgentRun> AddRunAsync(AgentRun run, CancellationToken ct);
        Task UpdateRunAsync(AgentRun run, CancellationToken ct);
        /// <summary>La fila <c>manual</c> en <c>requested</c> más reciente del mismo dueño+agente+trigger pedida desde <paramref name="since"/>.</summary>
        Task<AgentRun?> FindOpenManualAsync(Guid ownerId, string agentKey, string? triggerId, DateTime since, CancellationToken ct);
        /// <summary>Corridas de un agente, más recientes primero.</summary>
        Task<IReadOnlyList<AgentRun>> ListRunsAsync(Guid ownerId, string agentKey, CancellationToken ct);
        Task DeleteRunsAsync(IReadOnlyCollection<Guid> ids, CancellationToken ct);
    }

    public sealed class EfAgentStore : IAgentStore
    {
        private readonly Func<GaleCoreDbContext> _newContext;

        public EfAgentStore(Func<GaleCoreDbContext> newContext) => _newContext = newContext;

        private static AgentKeyRow ToRow(AgentKey k) => new(k.OwnerId, k.KeyHash, k.KeyHint, k.CreatedAt);

        public async Task<AgentKeyRow?> GetKeyByOwnerAsync(Guid ownerId, CancellationToken ct)
        {
            await using var db = _newContext();
            var k = await db.AgentKeys.AsNoTracking().FirstOrDefaultAsync(x => x.OwnerId == ownerId, ct);
            return k == null ? null : ToRow(k);
        }

        public async Task<AgentKeyRow?> GetKeyByHashAsync(string keyHash, CancellationToken ct)
        {
            await using var db = _newContext();
            var k = await db.AgentKeys.AsNoTracking().FirstOrDefaultAsync(x => x.KeyHash == keyHash, ct);
            return k == null ? null : ToRow(k);
        }

        public async Task UpsertKeyAsync(Guid ownerId, string keyHash, string keyHint, DateTime now, CancellationToken ct)
        {
            await using var db = _newContext();
            var k = await db.AgentKeys.FirstOrDefaultAsync(x => x.OwnerId == ownerId, ct);
            if (k == null) { k = new AgentKey { OwnerId = ownerId }; db.AgentKeys.Add(k); }
            k.KeyHash = keyHash;
            k.KeyHint = keyHint;
            k.CreatedAt = now;
            await db.SaveChangesAsync(ct);
        }

        public async Task<bool> DeleteKeyAsync(Guid ownerId, CancellationToken ct)
        {
            await using var db = _newContext();
            var k = await db.AgentKeys.FirstOrDefaultAsync(x => x.OwnerId == ownerId, ct);
            if (k == null) return false;
            db.AgentKeys.Remove(k);
            await db.SaveChangesAsync(ct);
            return true;
        }

        public async Task<bool> AgentExistsAsync(Guid ownerId, string agentKey, CancellationToken ct)
        {
            await using var db = _newContext();
            return await db.TraderSpaceItems.AsNoTracking()
                .AnyAsync(i => i.OwnerId == ownerId && i.Kind == "agent" && i.Key == agentKey, ct);
        }

        private static AgentFireTokenRow ToRow(AgentFireToken t) =>
            new(t.OwnerId, t.AgentKey, t.TriggerId, t.TokenCipher, t.TokenHint, t.UpdatedAt, t.LastFiredAt);

        public async Task<AgentFireTokenRow?> GetFireTokenAsync(Guid ownerId, string agentKey, CancellationToken ct)
        {
            await using var db = _newContext();
            var t = await db.AgentFireTokens.AsNoTracking().FirstOrDefaultAsync(x => x.OwnerId == ownerId && x.AgentKey == agentKey, ct);
            return t == null ? null : ToRow(t);
        }

        public async Task UpsertFireTokenAsync(Guid ownerId, string agentKey, string triggerId, string cipher, string hint, DateTime now, CancellationToken ct)
        {
            await using var db = _newContext();
            var t = await db.AgentFireTokens.FirstOrDefaultAsync(x => x.OwnerId == ownerId && x.AgentKey == agentKey, ct);
            if (t == null) { t = new AgentFireToken { OwnerId = ownerId, AgentKey = agentKey }; db.AgentFireTokens.Add(t); }
            t.TriggerId = triggerId;
            t.TokenCipher = cipher;
            t.TokenHint = hint;
            t.UpdatedAt = now;
            t.LastFiredAt = null;
            await db.SaveChangesAsync(ct);
        }

        public async Task<bool> DeleteFireTokenAsync(Guid ownerId, string agentKey, CancellationToken ct)
        {
            await using var db = _newContext();
            var t = await db.AgentFireTokens.FirstOrDefaultAsync(x => x.OwnerId == ownerId && x.AgentKey == agentKey, ct);
            if (t == null) return false;
            db.AgentFireTokens.Remove(t);
            await db.SaveChangesAsync(ct);
            return true;
        }

        public async Task MarkFiredAsync(Guid ownerId, string agentKey, DateTime at, CancellationToken ct)
        {
            await using var db = _newContext();
            var t = await db.AgentFireTokens.FirstOrDefaultAsync(x => x.OwnerId == ownerId && x.AgentKey == agentKey, ct);
            if (t == null) return;
            t.LastFiredAt = at;
            await db.SaveChangesAsync(ct);
        }

        public async Task<AgentRun> AddRunAsync(AgentRun run, CancellationToken ct)
        {
            await using var db = _newContext();
            db.AgentRuns.Add(run);
            await db.SaveChangesAsync(ct);
            return run;
        }

        public async Task UpdateRunAsync(AgentRun run, CancellationToken ct)
        {
            await using var db = _newContext();
            db.AgentRuns.Update(run);
            await db.SaveChangesAsync(ct);
        }

        public async Task<AgentRun?> FindOpenManualAsync(Guid ownerId, string agentKey, string? triggerId, DateTime since, CancellationToken ct)
        {
            await using var db = _newContext();
            return await db.AgentRuns.AsNoTracking()
                .Where(r => r.OwnerId == ownerId && r.AgentKey == agentKey && r.Origin == "manual" && r.Status == "requested"
                            && r.TriggerId == triggerId && r.RequestedAt >= since)
                .OrderByDescending(r => r.RequestedAt)
                .FirstOrDefaultAsync(ct);
        }

        public async Task<IReadOnlyList<AgentRun>> ListRunsAsync(Guid ownerId, string agentKey, CancellationToken ct)
        {
            await using var db = _newContext();
            return await db.AgentRuns.AsNoTracking()
                .Where(r => r.OwnerId == ownerId && r.AgentKey == agentKey)
                .OrderByDescending(r => r.CreatedAt)
                .ToListAsync(ct);
        }

        public async Task DeleteRunsAsync(IReadOnlyCollection<Guid> ids, CancellationToken ct)
        {
            if (ids.Count == 0) return;
            await using var db = _newContext();
            await db.AgentRuns.Where(r => ids.Contains(r.Id)).ExecuteDeleteAsync(ct);
        }
    }
}
