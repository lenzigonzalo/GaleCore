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

        [Fact]
        public void BorrarUnUsuarioNoBorraSusCambiosEnProyectosAjenos()
        {
            // El FK del autor no es CASCADE: la base frena borrar a quien editó (los cambios de un proyecto ajeno no se pierden).
            // Borrar al dueño sí arrastra el proyecto y, por él, sus cambios (FK del proyecto).
            var options = new DbContextOptionsBuilder<GaleCoreDbContext>().UseNpgsql("Host=localhost;Database=model_only").UseSnakeCaseNamingConvention().Options;
            using var db = new GaleCoreDbContext(options);
            var fks = db.Model.FindEntityType(typeof(SharedProjectChange))!.GetForeignKeys().ToList();
            Assert.Equal(DeleteBehavior.NoAction, fks.Single(f => f.PrincipalEntityType.ClrType == typeof(User)).DeleteBehavior);
            Assert.Equal(DeleteBehavior.Cascade, fks.Single(f => f.PrincipalEntityType.ClrType == typeof(SharedProject)).DeleteBehavior);
        }


        // ── Sugerencias de usuarios ──
        private static IQueryable<User> Usuarios(Guid yo) => new List<User>
        {
            new() { Id = yo, Username = "gonza", DisplayName = "Gonzalo L", Email = "g@x.com" },
            new() { Id = Guid.NewGuid(), Username = "elenzi", DisplayName = "Eric Lenzi", Email = "e@x.com" },
            new() { Id = Guid.NewGuid(), Username = "marta", DisplayName = "Marta Lenzi", Email = "m@x.com" },
            new() { Id = Guid.NewGuid(), Username = "pablo", DisplayName = null, Email = "p@x.com" },
        }.AsQueryable();

        [Fact]
        public void BuscarUsuariosPorPrefijoOContenidoSinMayusculasYSinElQueConsulta()
        {
            var yo = Guid.NewGuid();
            var users = Usuarios(yo);
            Assert.Equal(new[] { "elenzi" }, UserSearch.Find(users, "elen", yo).Select(u => u.Username));
            Assert.Equal("Eric Lenzi", UserSearch.Find(users, "elen", yo).Single().DisplayName);
            // por nombre, contiene; el que empieza con el texto va primero; yo (gonza) no aparece
            Assert.Equal(new[] { "elenzi", "marta" }, UserSearch.Find(users, "lenzi", yo).Select(u => u.Username));
            Assert.Empty(UserSearch.Find(users, "gonz", yo));
            Assert.Equal(new[] { "pablo" }, UserSearch.Find(users, UserSearch.Normalize("  PAB ")!, yo).Select(u => u.Username));
        }

        [Fact]
        public void BuscarUsuariosExigeDosCaracteresYTopeDeDiez()
        {
            Assert.Null(UserSearch.Normalize("e"));
            Assert.Null(UserSearch.Normalize(" "));
            Assert.Null(UserSearch.Normalize(null));
            Assert.Equal("el", UserSearch.Normalize("El"));
            var yo = Guid.NewGuid();
            var muchos = Enumerable.Range(0, 25).Select(i => new User { Id = Guid.NewGuid(), Username = $"user{i:00}", Email = $"u{i}@x.com" }).AsQueryable();
            Assert.Equal(UserSearch.MaxResults, UserSearch.Find(muchos, "user", yo).Count);
        }

        [Fact]
        public void BuscarPorMailEsExactoSinMayusculasYNoDevuelveElMail()
        {
            var yo = Guid.NewGuid();
            var users = Usuarios(yo);
            var r = UserSearch.Find(users, UserSearch.Normalize(" E@X.com ")!, yo);
            Assert.Equal(new[] { "elenzi" }, r.Select(u => u.Username));
            Assert.Equal("Eric Lenzi", r.Single().DisplayName);
            // un mail parcial no matchea (ni por mail ni por usuario/nombre)
            Assert.Empty(UserSearch.Find(users, "e@x", yo));
            Assert.Empty(UserSearch.Find(users, "@x.com", yo));
            // el propio mail no se devuelve
            Assert.Empty(UserSearch.Find(users, "g@x.com", yo));
        }

        [Fact]
        public void ElAccesoSoloAceptaRestrictedOEveryone()
        {
            Assert.Null(SharedProject.ValidateAccess("restricted"));
            Assert.Null(SharedProject.ValidateAccess("everyone"));
            Assert.NotNull(SharedProject.ValidateAccess("public"));
            Assert.NotNull(SharedProject.ValidateAccess("Everyone"));
            Assert.NotNull(SharedProject.ValidateAccess(""));
            Assert.NotNull(SharedProject.ValidateAccess(null));
            Assert.Equal("restricted", new SharedProject().Access);
        }

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
        public async Task DosEscriturasConcurrentesDesdeLaMismaBaseConservanUnConflicto()
        {
            using var db = NewDb();
            var u = NewUser("race"); var p = NewProject(u);
            db.Users.Add(u); db.SharedProjects.Add(p); await db.SaveChangesAsync();
            try
            {
                async Task<SharedProjectChange.Outcome> Append(string text, string? basis)
                {
                    using var connection = NewDb();
                    var (_, hash) = SharedProjectChange.ValidateAndHash("README.md", "put", "utf8", text);
                    var change = NewChange(p, u); change.Content = text; change.ContentHash = hash; change.BaseHash = basis;
                    return (await SharedProjectWriter.AppendAsync(connection, change)).Outcome;
                }
                var first = await Task.WhenAll(Append("primera A", null), Append("primera B", null));
                Assert.Single(first.Where(o => o == SharedProjectChange.Outcome.Accept));
                Assert.Single(first.Where(o => o == SharedProjectChange.Outcome.Conflict));
                var basis = await db.SharedProjectChanges.Where(c => c.ProjectId == p.Id).Select(c => c.ContentHash).SingleAsync();
                var edits = await Task.WhenAll(Append("edición A", basis), Append("edición B", basis));
                Assert.Single(edits.Where(o => o == SharedProjectChange.Outcome.Accept));
                Assert.Single(edits.Where(o => o == SharedProjectChange.Outcome.Conflict));
                Assert.Equal(2, await db.SharedProjectChanges.CountAsync(c => c.ProjectId == p.Id));
            }
            finally
            {
                db.SharedProjects.Remove(p); await db.SaveChangesAsync();
                db.Users.Remove(u); await db.SaveChangesAsync();
            }
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

        [PostgresFact]
        public async Task NoSeBorraAQuienEditoUnProyectoAjeno()
        {
            using var db = NewDb();
            var owner = NewUser("o"); var author = NewUser("w"); var p = NewProject(owner);
            db.Users.AddRange(owner, author); db.SharedProjects.Add(p);
            await db.SaveChangesAsync();
            db.SharedProjectChanges.Add(NewChange(p, author));
            await db.SaveChangesAsync();

            // SQL directo: el borrado lo decide la base, no el seguimiento de EF.
            await Assert.ThrowsAnyAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("DELETE FROM users WHERE id = {0}", author.Id));

            using var db2 = NewDb();
            await db2.Database.ExecuteSqlRawAsync("DELETE FROM users WHERE id = {0}", owner.Id); // el dueño sí se lleva el proyecto y sus cambios
            Assert.False(await db2.SharedProjectChanges.AnyAsync(c => c.ProjectId == p.Id));
        }

        // ── Acceso general (WS-0056) ──
        [PostgresFact]
        public async Task ElAccesoPorDefectoEsRestrictedYLaBaseRechazaOtroValor()
        {
            using var db = NewDb();
            var u = NewUser("acc"); var p = NewProject(u);
            db.Users.Add(u); db.SharedProjects.Add(p);
            await db.SaveChangesAsync();
            Assert.Equal("restricted", await db.SharedProjects.Where(x => x.Id == p.Id).Select(x => x.Access).SingleAsync());
            await Assert.ThrowsAnyAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("UPDATE shared_projects SET access = 'public' WHERE id = {0}", p.Id));
        }

        [PostgresFact]
        public async Task ElListadoSumaLosEveryoneConMemberFalseYSinMiembros()
        {
            using var db = NewDb();
            var owner = NewUser("lo"); var other = NewUser("lx");
            var restringido = NewProject(owner); var abierto = NewProject(owner); abierto.Access = "everyone";
            restringido.Name = "r-" + Guid.NewGuid().ToString("N"); abierto.Name = "a-" + Guid.NewGuid().ToString("N");
            db.Users.AddRange(owner, other); db.SharedProjects.AddRange(restringido, abierto);
            await db.SaveChangesAsync();

            var mios = await SharedProjectAccess.ListAsync(db, owner.Id, null, default);
            Assert.True(mios.Single(r => r.Id == abierto.Id).Member);
            Assert.True(mios.Single(r => r.Id == restringido.Id).Member);
            Assert.Equal("everyone", mios.Single(r => r.Id == abierto.Id).Access);

            var ajenos = await SharedProjectAccess.ListAsync(db, other.Id, null, default);
            var fila = ajenos.Single(r => r.Id == abierto.Id);
            Assert.False(fila.Member);
            Assert.Empty(fila.Members);
            Assert.DoesNotContain(ajenos, r => r.Id == restringido.Id);
        }

        [PostgresFact]
        public async Task SoloElOwnerCambiaElAccesoYElValorDebeValer()
        {
            using var db = NewDb();
            var owner = NewUser("po"); var member = NewUser("pm"); var ajeno = NewUser("pa");
            var p = NewProject(owner);
            p.Members.Add(new SharedProjectMember { UserId = member.Id, Role = "member", AddedAt = DateTime.UtcNow });
            db.Users.AddRange(owner, member, ajeno); db.SharedProjects.Add(p);
            await db.SaveChangesAsync();

            Assert.Equal(SharedProjectAccess.Outcome.NotFound, (await SharedProjectAccess.SetAsync(db, p.Id, ajeno.Id, "everyone", default)).Outcome);
            Assert.Equal(SharedProjectAccess.Outcome.Forbidden, (await SharedProjectAccess.SetAsync(db, p.Id, member.Id, "everyone", default)).Outcome);
            Assert.Equal(SharedProjectAccess.Outcome.Invalid, (await SharedProjectAccess.SetAsync(db, p.Id, owner.Id, "public", default)).Outcome);
            Assert.Equal(SharedProjectAccess.Outcome.Ok, (await SharedProjectAccess.SetAsync(db, p.Id, owner.Id, "everyone", default)).Outcome);
            using var db2 = NewDb();
            Assert.Equal("everyone", await db2.SharedProjects.Where(x => x.Id == p.Id).Select(x => x.Access).SingleAsync());
        }

        [PostgresFact]
        public async Task JoinSumaAlQueNoEsMiembroSoloSiEsEveryoneYEsIdempotente()
        {
            using var db = NewDb();
            var owner = NewUser("jo"); var otro = NewUser("jx");
            var abierto = NewProject(owner); abierto.Access = "everyone";
            var cerrado = NewProject(owner);
            db.Users.AddRange(owner, otro); db.SharedProjects.AddRange(abierto, cerrado);
            await db.SaveChangesAsync();

            Assert.Equal(SharedProjectAccess.Outcome.NotFound, await SharedProjectAccess.JoinAsync(db, cerrado.Id, otro.Id, default));
            Assert.Equal(SharedProjectAccess.Outcome.NotFound, await SharedProjectAccess.JoinAsync(db, Guid.NewGuid(), otro.Id, default));
            Assert.Equal(SharedProjectAccess.Outcome.Ok, await SharedProjectAccess.JoinAsync(db, abierto.Id, otro.Id, default));
            Assert.Equal(SharedProjectAccess.Outcome.Ok, await SharedProjectAccess.JoinAsync(db, abierto.Id, otro.Id, default));
            Assert.Equal(1, await db.SharedProjectMembers.CountAsync(m => m.ProjectId == abierto.Id && m.UserId == otro.Id && m.Role == "member"));

            var fila = (await SharedProjectAccess.ListAsync(db, otro.Id, abierto.Id, default)).Single();
            Assert.True(fila.Member);
            Assert.Equal(2, fila.Members.Count);

            // ya miembro de un restringido: 200 (por ejemplo, el owner)
            Assert.Equal(SharedProjectAccess.Outcome.Ok, await SharedProjectAccess.JoinAsync(db, cerrado.Id, owner.Id, default));
        }
    }
}
