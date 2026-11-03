using DataFeed.Repositories.Entities;
using Microsoft.EntityFrameworkCore;

namespace DataFeed.Repositories
{
    public class SharedProjectMemberRow
    {
        public string Username { get; set; } = "";
        public string? DisplayName { get; set; }
        public string Role { get; set; } = "";
    }

    /// <summary>La fila que devuelven GET, PATCH y join de SharedProjects (una sola proyección).</summary>
    public class SharedProjectRow
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = "";
        public string Kind { get; set; } = "";
        public string LocalKey { get; set; } = "";
        public DateTime CreatedAt { get; set; }
        public string Owner { get; set; } = "";
        public long LastSeq { get; set; }
        public string Access { get; set; } = "restricted";
        /// <summary>¿Soy miembro? Si no, el proyecto es <c>everyone</c> y todavía no me sumé.</summary>
        public bool Member { get; set; }
        public List<SharedProjectMemberRow> Members { get; set; } = new();
    }

    /// <summary>Acceso general de los proyectos compartidos (WS-0056): listado, cambio de acceso y «sumarme».</summary>
    public static class SharedProjectAccess
    {
        public enum Outcome { Ok, NotFound, Forbidden, Invalid }

        /// <summary>Mis proyectos más los <c>everyone</c> donde no soy miembro, por nombre. Quien no es miembro no ve la lista de miembros.</summary>
        public static async Task<List<SharedProjectRow>> ListAsync(GaleCoreDbContext db, Guid userId, Guid? onlyId, CancellationToken ct)
        {
            var rows = await db.SharedProjects.AsNoTracking()
                .Where(p => (onlyId == null || p.Id == onlyId) && (p.Access == "everyone" || p.Members.Any(m => m.UserId == userId)))
                .OrderBy(p => p.Name)
                .Select(p => new SharedProjectRow
                {
                    Id = p.Id, Name = p.Name, Kind = p.Kind, LocalKey = p.LocalKey, CreatedAt = p.CreatedAt, Owner = p.Owner.Username,
                    LastSeq = db.SharedProjectChanges.Where(c => c.ProjectId == p.Id).Max(c => (long?)c.Seq) ?? 0L,
                    Access = p.Access,
                    Member = p.Members.Any(m => m.UserId == userId),
                    Members = p.Members.OrderBy(m => m.AddedAt)
                        .Select(m => new SharedProjectMemberRow { Username = m.User.Username, DisplayName = m.User.DisplayName, Role = m.Role }).ToList(),
                })
                .ToListAsync(ct);
            foreach (var r in rows.Where(r => !r.Member)) r.Members = new();
            return rows;
        }

        /// <summary>Cambia el acceso. 404 si no soy miembro, 403 si no soy owner, 400 si el valor no vale.</summary>
        public static async Task<(Outcome Outcome, string? Error)> SetAsync(GaleCoreDbContext db, Guid id, Guid userId, string? access, CancellationToken ct)
        {
            var project = await db.SharedProjects.FirstOrDefaultAsync(p => p.Id == id && p.Members.Any(m => m.UserId == userId), ct);
            if (project == null) return (Outcome.NotFound, null);
            if (project.OwnerId != userId) return (Outcome.Forbidden, "sólo el owner del proyecto puede cambiar el acceso");
            var problem = SharedProject.ValidateAccess(access);
            if (problem != null) return (Outcome.Invalid, problem);
            if (project.Access != access)
            {
                project.Access = access!;
                project.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync(ct);
            }
            return (Outcome.Ok, null);
        }

        /// <summary>Me suma como member si el proyecto es <c>everyone</c> (idempotente). Restringido y no miembro: 404.</summary>
        public static async Task<Outcome> JoinAsync(GaleCoreDbContext db, Guid id, Guid userId, CancellationToken ct)
        {
            var project = await db.SharedProjects.AsNoTracking().Where(p => p.Id == id)
                .Select(p => new { p.Access, IsMember = p.Members.Any(m => m.UserId == userId) }).FirstOrDefaultAsync(ct);
            if (project == null || (project.Access != "everyone" && !project.IsMember)) return Outcome.NotFound;
            if (!project.IsMember)
            {
                db.SharedProjectMembers.Add(new SharedProjectMember { ProjectId = id, UserId = userId, Role = "member", AddedAt = DateTime.UtcNow });
                try { await db.SaveChangesAsync(ct); }
                catch (DbUpdateException) { } // carrera con otro join mío: la clave (proyecto, usuario) ya existe, queda sumado
            }
            return Outcome.Ok;
        }
    }
}
