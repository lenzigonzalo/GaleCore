using DataFeed.Repositories;
using DataFeed.Repositories.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace DataFeed.Tests
{
    /// <summary>WS-0064 Fase 2a: reglas de proyectos compartidos (validación, hash del servidor, regla de conflicto).</summary>
    public class SharedProjectTests
    {
        private static SharedProjectChange Put(string hash, long seq = 1) => new() { Seq = seq, Op = "put", ContentHash = hash };
        private static SharedProjectChange Del(long seq = 2) => new() { Seq = seq, Op = "delete" };

        // ── Proyecto ──
        [Fact]
        public void UnProyectoValidoSeAcepta()
        {
            Assert.Null(SharedProject.Validate("Mi estrategia", "strategy", "mi-estrategia"));
            Assert.Null(SharedProject.Validate("Investigación", "workspace", "investigacion"));
        }

        [Theory]
        [InlineData("", "workspace", "k")]
        [InlineData(" ", "workspace", "k")]
        [InlineData("n", "otro", "k")]
        [InlineData("n", null, "k")]
        [InlineData("n", "workspace", "")]
        [InlineData("n", "workspace", null)]
        public void UnProyectoInvalidoSeRechazaConMotivo(string? name, string? kind, string? localKey)
            => Assert.NotNull(SharedProject.Validate(name, kind, localKey));

        [Fact]
        public void NombreYCarpetaTienenTope()
        {
            Assert.NotNull(SharedProject.Validate(new string('a', 201), "workspace", "k"));
            Assert.NotNull(SharedProject.Validate("n", "workspace", new string('a', 201)));
            Assert.Null(SharedProject.Validate(new string('a', 200), "workspace", new string('a', 200)));
        }

        // ── Rutas ──
        [Theory]
        [InlineData("README.md")]
        [InlineData("memory/notas/2026-10.md")]
        [InlineData("1.3.0.proposal.json")]
        [InlineData("files/a..b.txt")]
        public void RutasValidas(string path) => Assert.Null(SharedProjectChange.ValidatePath(path));

        [Theory]
        [InlineData("")]
        [InlineData("/etc/passwd")]
        [InlineData("../fuera.md")]
        [InlineData("a/../b.md")]
        [InlineData("a/..")]
        [InlineData("./a.md")]
        [InlineData("a\\b.md")]
        [InlineData("a//b.md")]
        [InlineData("a/")]
        [InlineData("a\nb")]
        public void RutasInvalidas(string path) => Assert.NotNull(SharedProjectChange.ValidatePath(path));

        [Fact]
        public void LaRutaTieneTopeDe400()
        {
            Assert.Null(SharedProjectChange.ValidatePath(new string('a', 400)));
            Assert.NotNull(SharedProjectChange.ValidatePath(new string('a', 401)));
        }

        // ── Cambio: validación y hash ──
        [Fact]
        public void ElHashLoCalculaElServidorSobreLosBytesDecodificados()
        {
            // sha256("hola")
            var (err, hash) = SharedProjectChange.ValidateAndHash("a.md", "put", "utf8", "hola");
            Assert.Null(err);
            Assert.Equal("b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79", hash);
            // el mismo contenido en base64 da el mismo hash
            var (err2, hash2) = SharedProjectChange.ValidateAndHash("a.md", "put", "base64", Convert.ToBase64String("hola"u8.ToArray()));
            Assert.Null(err2);
            Assert.Equal(hash, hash2);
        }

        [Fact]
        public void UnDeleteNoTieneHashNiNecesitaContenido()
        {
            var (err, hash) = SharedProjectChange.ValidateAndHash("a.md", "delete", null, null);
            Assert.Null(err);
            Assert.Null(hash);
        }

        [Theory]
        [InlineData("a.md", "patch", "utf8", "x")]
        [InlineData("a.md", "put", "latin1", "x")]
        [InlineData("a.md", "put", "utf8", null)]
        [InlineData("a.md", "put", "base64", "no es base64!")]
        [InlineData("../a.md", "put", "utf8", "x")]
        public void UnCambioInvalidoSeRechaza(string path, string op, string encoding, string? content)
            => Assert.NotNull(SharedProjectChange.ValidateAndHash(path, op, encoding, content).Error);

        [Fact]
        public void ElContenidoTieneTopeDe2MbDecodificado()
        {
            var max = new string('a', SharedProjectChange.MaxContentBytes);
            Assert.Null(SharedProjectChange.ValidateAndHash("a.md", "put", "utf8", max).Error);
            Assert.NotNull(SharedProjectChange.ValidateAndHash("a.md", "put", "utf8", max + "a").Error);

            var okBytes = Convert.ToBase64String(new byte[SharedProjectChange.MaxContentBytes]);
            var bigBytes = Convert.ToBase64String(new byte[SharedProjectChange.MaxContentBytes + 1]);
            Assert.Null(SharedProjectChange.ValidateAndHash("a.bin", "put", "base64", okBytes).Error);
            Assert.NotNull(SharedProjectChange.ValidateAndHash("a.bin", "put", "base64", bigBytes).Error);
        }

        // ── Regla de conflicto ──
        [Fact]
        public void ArchivoNuevoSinBaseSeAcepta()
            => Assert.Equal(SharedProjectChange.Outcome.Accept, SharedProjectChange.Decide(null, "put", "h1", null));

        [Fact]
        public void ArchivoNuevoConBaseSeRechaza()
            => Assert.Equal(SharedProjectChange.Outcome.Conflict, SharedProjectChange.Decide(null, "put", "h1", "h0"));

        [Fact]
        public void ActualizarConLaBaseCorrectaSeAcepta()
            => Assert.Equal(SharedProjectChange.Outcome.Accept, SharedProjectChange.Decide(Put("h1"), "put", "h2", "h1"));

        [Fact]
        public void ActualizarConBaseVieja409()
            => Assert.Equal(SharedProjectChange.Outcome.Conflict, SharedProjectChange.Decide(Put("h2"), "put", "h3", "h1"));

        [Fact]
        public void CrearElMismoArchivoConOtroContenido409()
            => Assert.Equal(SharedProjectChange.Outcome.Conflict, SharedProjectChange.Decide(Put("h1"), "put", "h2", null));

        [Fact]
        public void BorrarConBaseCorrectaSeAceptaYConBaseVieja409()
        {
            Assert.Equal(SharedProjectChange.Outcome.Accept, SharedProjectChange.Decide(Put("h1"), "delete", null, "h1"));
            Assert.Equal(SharedProjectChange.Outcome.Conflict, SharedProjectChange.Decide(Put("h2"), "delete", null, "h1"));
        }

        [Fact]
        public void DespuesDeUnDeleteSoloSeAceptaUnArchivoNuevo()
        {
            Assert.Equal(SharedProjectChange.Outcome.Accept, SharedProjectChange.Decide(Del(), "put", "h1", null));
            Assert.Equal(SharedProjectChange.Outcome.Conflict, SharedProjectChange.Decide(Del(), "put", "h1", "h0"));
            // borrar lo ya borrado: sin base se acepta (queda registrado), con base vieja no
            Assert.Equal(SharedProjectChange.Outcome.Conflict, SharedProjectChange.Decide(Del(), "delete", null, "h0"));
        }

        [Fact]
        public void UnPutConElMismoHashQueElUltimoNoCambiaNada()
        {
            Assert.Equal(SharedProjectChange.Outcome.NoOp, SharedProjectChange.Decide(Put("h1"), "put", "h1", "h1"));
            // aunque su base esté vieja o sea null: converge, no es conflicto
            Assert.Equal(SharedProjectChange.Outcome.NoOp, SharedProjectChange.Decide(Put("h1"), "put", "h1", "h0"));
            Assert.Equal(SharedProjectChange.Outcome.NoOp, SharedProjectChange.Decide(Put("h1"), "put", "h1", null));
        }

        [Fact]
        public void ElPaginadoEsDe500()
            => Assert.Equal(500, SharedProjectChange.PageSize);
    }

    /// <summary>
    /// WS-0064 Fase 2a contra PostgreSQL real (GALECORE_TEST_DB, base *_test): el esquema aplica, el seq crece
    /// de forma global, los CHECK de la base frenan lo inválido y borrar el proyecto arrastra miembros y cambios.
    /// </summary>
    [Collection("PostgresTestDb")]
    public class SharedProjectDbTests
    {
        private static readonly string? ConnectionString = Environment.GetEnvironmentVariable("GALECORE_TEST_DB");
        private static readonly object MigrateLock = new();
        private static bool _migrated;

        private static GaleCoreDbContext NewDb()
        {
            var options = new DbContextOptionsBuilder<GaleCoreDbContext>().UseNpgsql(ConnectionString).UseSnakeCaseNamingConvention().Options;
            lock (MigrateLock)
            {
                if (!_migrated)
                {
                    var admin = new NpgsqlConnectionStringBuilder(ConnectionString) { Database = "postgres" };
                    using (var conn = new NpgsqlConnection(admin.ConnectionString))
                    {
                        conn.Open();
                        using var exists = new NpgsqlCommand("SELECT 1 FROM pg_database WHERE datname = @n", conn);
                        exists.Parameters.AddWithValue("n", new NpgsqlConnectionStringBuilder(ConnectionString).Database!);
                        if (exists.ExecuteScalar() == null)
                            new NpgsqlCommand($"CREATE DATABASE \"{new NpgsqlConnectionStringBuilder(ConnectionString).Database}\"", conn).ExecuteNonQuery();
                    }
                    using var m = new GaleCoreDbContext(options);
                    m.Database.Migrate();
                    _migrated = true;
                }
            }
            return new GaleCoreDbContext(options);
        }

        private static User NewUser(string name) => new()
        {
            Id = Guid.NewGuid(), Email = $"{name}-{Guid.NewGuid():N}@test.local", Username = $"{name}{Guid.NewGuid():N}"[..20],
            CreatedAt = DateTime.UtcNow,
        };

        private static SharedProject NewProject(User owner)
        {
            var p = new SharedProject { Id = Guid.NewGuid(), OwnerId = owner.Id, Name = "p", Kind = "strategy", LocalKey = "p", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
            p.Members.Add(new SharedProjectMember { UserId = owner.Id, Role = "owner", AddedAt = DateTime.UtcNow });
            return p;
        }

        private static SharedProjectChange NewChange(SharedProject p, User author, string path = "README.md", string op = "put") => new()
        {
            ProjectId = p.Id, AuthorId = author.Id, Path = path, Op = op, Encoding = "utf8",
            Content = op == "put" ? "x" : null, ContentHash = op == "put" ? "ab" : null, CreatedAt = DateTime.UtcNow,
        };

        [PostgresFact]
        public async Task ElSeqEsGlobalYCreciente()
        {
            using var db = NewDb();
            var u = NewUser("a"); var p1 = NewProject(u); var p2 = NewProject(u);
            db.Users.Add(u); db.SharedProjects.AddRange(p1, p2);
            await db.SaveChangesAsync();
            var c1 = NewChange(p1, u); var c2 = NewChange(p2, u); var c3 = NewChange(p1, u, "memory/a.md");
            db.SharedProjectChanges.Add(c1); await db.SaveChangesAsync();
            db.SharedProjectChanges.Add(c2); await db.SaveChangesAsync();
            db.SharedProjectChanges.Add(c3); await db.SaveChangesAsync();
            Assert.True(c1.Seq < c2.Seq && c2.Seq < c3.Seq);
            var after = await db.SharedProjectChanges.Where(c => c.ProjectId == p1.Id && c.Seq > c1.Seq).OrderBy(c => c.Seq).Select(c => c.Path).ToListAsync();
            Assert.Equal(new[] { "memory/a.md" }, after);
        }

        [PostgresFact]
        public async Task LaBaseRechazaRutasYValoresInvalidos()
        {
            using var db = NewDb();
            var u = NewUser("b"); var p = NewProject(u);
            db.Users.Add(u); db.SharedProjects.Add(p);
            await db.SaveChangesAsync();
            foreach (var bad in new[] { "/abs.md", "a/../b.md", "a\\b.md" })
            {
                db.SharedProjectChanges.Add(NewChange(p, u, bad));
                await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
                db.ChangeTracker.Clear();
            }
            var badOp = NewChange(p, u); badOp.Op = "patch";
            db.SharedProjectChanges.Add(badOp);
            await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        }

        [PostgresFact]
        public async Task BorrarElProyectoArrastraMiembrosYCambios()
        {
            using var db = NewDb();
            var owner = NewUser("o"); var member = NewUser("m"); var p = NewProject(owner);
            p.Members.Add(new SharedProjectMember { UserId = member.Id, Role = "member", AddedAt = DateTime.UtcNow });
            db.Users.AddRange(owner, member); db.SharedProjects.Add(p);
            await db.SaveChangesAsync();
            db.SharedProjectChanges.Add(NewChange(p, member));
            await db.SaveChangesAsync();

            db.SharedProjects.Remove(await db.SharedProjects.FirstAsync(x => x.Id == p.Id));
            await db.SaveChangesAsync();

            Assert.False(await db.SharedProjectMembers.AnyAsync(m => m.ProjectId == p.Id));
            Assert.False(await db.SharedProjectChanges.AnyAsync(c => c.ProjectId == p.Id));
            Assert.True(await db.Users.AnyAsync(x => x.Id == member.Id));
        }

        [PostgresFact]
        public async Task UnMiembroSoloApareceUnaVezPorProyecto()
        {
            using var db = NewDb();
            var u = NewUser("c"); var p = NewProject(u);
            db.Users.Add(u); db.SharedProjects.Add(p);
            await db.SaveChangesAsync();
            using var db2 = NewDb();
            db2.SharedProjectMembers.Add(new SharedProjectMember { ProjectId = p.Id, UserId = u.Id, Role = "member", AddedAt = DateTime.UtcNow });
            await Assert.ThrowsAsync<DbUpdateException>(() => db2.SaveChangesAsync());
        }
    }
}
