using DataFeed.Repositories;
using DataFeed.Repositories.Entities;
using Microsoft.EntityFrameworkCore;

namespace DataFeed.Application.App.Agents
{
    public sealed record AgentKeyRow(Guid OwnerId, string KeyHash, string KeyHint, DateTime CreatedAt);

    public sealed record AgentFireTokenRow(
        Guid OwnerId, string AgentKey, string TriggerId, string TokenCipher, string TokenHint, DateTime UpdatedAt, DateTime? LastFiredAt);

    /// <summary>Pieza <c>skill</c> del espacio tal como la lee la clave de agentes (mismos campos que un ítem de GET GaleCore/Space).</summary>
    public sealed record AgentSkillRow(
        string Kind, string Key, string Title, string Content, string Format, string Visibility, int Version, DateTime UpdatedAt,
        string Owner, Guid OwnerId);

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

        /// <summary>Piezas <c>skill</c> con esa clave que el usuario puede leer: las suyas y las compartidas por otros.</summary>
        Task<IReadOnlyList<AgentSkillRow>> GetSkillsAsync(Guid ownerId, string skillKey, CancellationToken ct);

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

        /// <summary>Guarda los avisos cuyo (dueño, agente, AlertId) todavía no existe; devuelve cuántos eran nuevos.</summary>
        Task<int> AddNewAlertsAsync(Guid ownerId, string agentKey, Guid runId, IReadOnlyList<(string AlertId, string Title)> alerts, DateTime now, CancellationToken ct);
        /// <summary>Avisos del dueño creados desde <paramref name="since"/>, más recientes primero.</summary>
        Task<IReadOnlyList<AgentAlert>> ListAlertsAsync(Guid ownerId, DateTime since, CancellationToken ct);
        Task DeleteAlertsBeforeAsync(Guid ownerId, DateTime before, CancellationToken ct);
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

        public async Task<IReadOnlyList<AgentSkillRow>> GetSkillsAsync(Guid ownerId, string skillKey, CancellationToken ct)
        {
            await using var db = _newContext();
            return await db.TraderSpaceItems.AsNoTracking()
                .Where(i => i.Kind == "skill" && i.Key == skillKey && (i.OwnerId == ownerId || i.Visibility == "shared"))
                .Select(i => new AgentSkillRow(i.Kind, i.Key, i.Title, i.Content, i.Format, i.Visibility, i.Version, i.UpdatedAt,
                    i.Owner.Username, i.OwnerId))
                .ToListAsync(ct);
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

        public async Task<int> AddNewAlertsAsync(Guid ownerId, string agentKey, Guid runId, IReadOnlyList<(string AlertId, string Title)> alerts, DateTime now, CancellationToken ct)
        {
            if (alerts.Count == 0) return 0;
            await using var db = _newContext();
            var ids = alerts.Select(a => a.AlertId).ToList();
            var seen = await db.AgentAlerts.AsNoTracking()
                .Where(a => a.OwnerId == ownerId && a.AgentKey == agentKey && ids.Contains(a.AlertId))
                .Select(a => a.AlertId).ToListAsync(ct);
            var fresh = alerts.Where(a => !seen.Contains(a.AlertId)).DistinctBy(a => a.AlertId).ToList();
            foreach (var a in fresh)
                db.AgentAlerts.Add(new AgentAlert { Id = Guid.NewGuid(), OwnerId = ownerId, AgentKey = agentKey, AlertId = a.AlertId, Title = a.Title, RunId = runId, CreatedAt = now });
            if (fresh.Count == 0) return 0;
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException) { return 0; } // otro reporte insertó el mismo aviso a la vez (índice único): ya existía
            return fresh.Count;
        }

        public async Task<IReadOnlyList<AgentAlert>> ListAlertsAsync(Guid ownerId, DateTime since, CancellationToken ct)
        {
            await using var db = _newContext();
            return await db.AgentAlerts.AsNoTracking()
                .Where(a => a.OwnerId == ownerId && a.CreatedAt >= since)
                .OrderByDescending(a => a.CreatedAt)
                .ToListAsync(ct);
        }

        public async Task DeleteAlertsBeforeAsync(Guid ownerId, DateTime before, CancellationToken ct)
        {
            await using var db = _newContext();
            await db.AgentAlerts.Where(a => a.OwnerId == ownerId && a.CreatedAt < before).ExecuteDeleteAsync(ct);
        }
    }
}
