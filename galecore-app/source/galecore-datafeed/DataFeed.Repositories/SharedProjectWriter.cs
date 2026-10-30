using DataFeed.Repositories.Entities;
using Microsoft.EntityFrameworkCore;

namespace DataFeed.Repositories;

/// <summary>Compare and append under the same database lock, across API processes.</summary>
public static class SharedProjectWriter
{
    public static async Task<(bool Authorized, SharedProjectChange.Outcome Outcome, SharedProjectChange? Change)> AppendAsync(
        GaleCoreDbContext db, SharedProjectChange change, CancellationToken ct = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var project = await db.SharedProjects
            .FromSqlInterpolated($"SELECT * FROM shared_projects WHERE id = {change.ProjectId} FOR UPDATE")
            .AsNoTracking().SingleOrDefaultAsync(ct);
        if (project == null || !await db.SharedProjectMembers.AnyAsync(m => m.ProjectId == change.ProjectId && m.UserId == change.AuthorId, ct))
            return (false, default, null);

        var latest = await db.SharedProjectChanges.AsNoTracking().Include(c => c.Author)
            .Where(c => c.ProjectId == change.ProjectId && c.Path == change.Path)
            .OrderByDescending(c => c.Seq).FirstOrDefaultAsync(ct);
        var outcome = SharedProjectChange.Decide(latest, change.Op, change.ContentHash, change.BaseHash);
        if (outcome != SharedProjectChange.Outcome.Accept)
            return (true, outcome, latest);

        db.SharedProjectChanges.Add(change);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return (true, outcome, change);
    }
}
