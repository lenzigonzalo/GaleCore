using DataFeed.Repositories.Entities;
using Microsoft.EntityFrameworkCore;

namespace DataFeed.Repositories
{
    /// <summary>
    /// Base de datos de dominio de GaleCore (PostgreSQL en Supabase, base "GaleCore").
    ///
    /// ALCANCE — lo que NO va acá:
    ///   * Las REGLAS de cada estrategia (galecore_rules_&lt;prefijo&gt;.json) y pop_calibration.json
    ///     siguen en git: se editan deliberadamente, se versionan y se revisan en un PR.
    ///   * El CATÁLOGO de estrategias. Su fuente de verdad es `strategies[]` de
    ///     galecore_rules_core.json, y el prefijo que declara está compilado ([Route("App/Rpf")],
    ///     Files/Rpf/, el tag de Swagger, el id de pestaña del front) — una tabla no puede ser
    ///     dueña de eso, solo mentir sobre eso. Hubo tablas `strategies` y `user_strategies` entre
    ///     el 2026-08-11 y el 2026-08-12: nadie leyó nunca el catálogo desde la base.
    ///     Ver docs/GaleCore-plan-reorganizacion-2026-08.md.
    ///   * El estado de runtime (*_switch_state.json, skew25_history.json) sigue en archivos: son
    ///     ~3 KB, ya sobreviven a un reinicio, y una base le agregaría a un kill switch el modo de
    ///     falla "¿y si no responde?". El switch de estrategia es GLOBAL y vive entero en el
    ///     archivo; lo único que sale de acá es el permiso para tocarlo (`users.is_admin`).
    ///   * Los datos de mercado NO se publican por acá. El camino caliente es en memoria.
    /// Ver docs/GaleCore-arquitectura-datos.md §5.
    ///
    /// Nombres en snake_case (EFCore.NamingConventions): es lo que espera cualquier SQL escrito a
    /// mano y lo que usa el propio esquema auth de Supabase. Con los nombres PascalCase de EF,
    /// Postgres los deja entre comillas y case-sensitive, que es una molestia permanente.
    /// </summary>
    public class GaleCoreDbContext : DbContext
    {
        public GaleCoreDbContext(DbContextOptions<GaleCoreDbContext> options) : base(options) { }

        public DbSet<User> Users => Set<User>();
        public DbSet<Account> Accounts => Set<Account>();
        public DbSet<TraderSpaceItem> TraderSpaceItems => Set<TraderSpaceItem>();
        public DbSet<StrategySettingEntity> StrategySettings => Set<StrategySettingEntity>();

        // ── Runtime (Trading Runtime SHADOW) ──
        public DbSet<StrategySpecEntity> StrategySpecs => Set<StrategySpecEntity>();
        public DbSet<StrategyDeploymentEntity> StrategyDeployments => Set<StrategyDeploymentEntity>();
        public DbSet<StrategyInstanceEntity> StrategyInstances => Set<StrategyInstanceEntity>();
        public DbSet<ShadowPositionEntity> ShadowPositions => Set<ShadowPositionEntity>();
        public DbSet<EvaluationLogEntity> EvaluationLogs => Set<EvaluationLogEntity>();
        public DbSet<OperationalEventEntity> OperationalEvents => Set<OperationalEventEntity>();

        protected override void OnModelCreating(ModelBuilder b)
        {
            b.Entity<User>(e =>
            {
                // El MISMO charset que Usernames.Pattern, congelado por UsernamesTests. Está en la
                // base además de en C# porque el UPDATE a mano contra Postgres no pasa por la app.
                e.ToTable("users", t => t.HasCheckConstraint("ck_users_username", "username ~ '^[a-z0-9._-]{3,32}$'"));
                e.HasKey(x => x.Id);
                // El uuid lo trae Supabase Auth: EF no debe generarlo ni pedirle uno a Postgres.
                e.Property(x => x.Id).ValueGeneratedNever();
                e.Property(x => x.Email).HasMaxLength(320).IsRequired();
                e.Property(x => x.Username).HasMaxLength(32).IsRequired();
                e.Property(x => x.DisplayName).HasMaxLength(120);
                e.Property(x => x.IsAdmin).HasDefaultValue(false);
                e.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
                e.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");
                e.HasIndex(x => x.Email).IsUnique();

                // El username es con lo que se entra: si hubiera dos iguales, el login no podría
                // resolver a qué mail corresponde. El único lo garantiza la base y no la aplicación
                // porque dos altas simultáneas ganarían las dos el chequeo previo.
                e.HasIndex(x => x.Username).IsUnique();
            });

            b.Entity<Account>(e =>
            {
                e.ToTable("accounts");
                e.HasKey(x => x.Id);
                e.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
                e.Property(x => x.Broker).HasMaxLength(40).IsRequired();
                e.Property(x => x.AccountNumber).HasMaxLength(40).IsRequired();
                e.Property(x => x.RefreshTokenEncrypted).IsRequired();

                // Sin IsRequired: null es un valor con significado —"usá el client_secret de
                // configuración"— y no un dato que falta. Ver Account.ClientSecretEncrypted.
                e.Property(x => x.ClientSecretEncrypted);
                e.Property(x => x.IsSystem).HasDefaultValue(false);
                e.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
                e.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");

                e.HasOne(x => x.User)
                 .WithMany(u => u.Accounts)
                 .HasForeignKey(x => x.UserId)
                 .OnDelete(DeleteBehavior.Cascade);

                e.HasIndex(x => new { x.UserId, x.Broker, x.AccountNumber }).IsUnique();

                // Como máximo UNA cuenta de sistema en toda la plataforma. Se hace con un índice
                // único parcial y no con lógica de aplicación: si hubiera dos, los procesos de fondo
                // elegirían una al azar y el bug sería intermitente y carísimo de encontrar.
                e.HasIndex(x => x.IsSystem)
                 .IsUnique()
                 .HasFilter("is_system")
                 .HasDatabaseName("ix_accounts_single_system");
            });

            // ── Runtime tables (Trading Runtime SHADOW) ──
            // Tablas separadas, sin FK a users/accounts. El runtime no depende de la identidad del
            // operador: las posiciones SHADOW son de la instancia, no de nadie.

            b.Entity<StrategySpecEntity>(e =>
            {
                e.ToTable("strategy_specs");
                e.HasKey(x => x.Id);
                e.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
                e.Property(x => x.Name).HasMaxLength(120).IsRequired();
                e.Property(x => x.DisplayName).HasMaxLength(120);
                e.Property(x => x.Version).HasMaxLength(20).IsRequired();
                e.Property(x => x.ContentHash).HasMaxLength(80).IsRequired();
                e.Property(x => x.SpecJson).IsRequired();
                e.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
                e.HasIndex(x => x.ContentHash).IsUnique();
            });

            b.Entity<StrategyDeploymentEntity>(e =>
            {
                e.ToTable("strategy_deployments");
                e.HasKey(x => x.Id);
                e.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
                e.Property(x => x.VersionHash).HasMaxLength(80).IsRequired();
                e.Property(x => x.Mode).HasMaxLength(10).IsRequired();
                e.Property(x => x.DeployedBy).HasMaxLength(80).IsRequired();
                e.Property(x => x.DeployedAt).HasDefaultValueSql("now()");
                e.HasOne(x => x.Spec).WithMany().HasForeignKey(x => x.SpecId).OnDelete(DeleteBehavior.Cascade);
            });

            b.Entity<StrategyInstanceEntity>(e =>
            {
                e.ToTable("strategy_instances");
                e.HasKey(x => x.Id);
                e.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
                e.Property(x => x.VersionHash).HasMaxLength(80).IsRequired();
                e.Property(x => x.LifecycleState).HasMaxLength(20).IsRequired();
                e.Property(x => x.SchedulerState).HasMaxLength(20).IsRequired();
                e.Property(x => x.SpecName).HasMaxLength(120);
                e.Property(x => x.Mode).HasMaxLength(10).IsRequired();
                e.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
                e.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");
                e.HasOne(x => x.Deployment).WithMany().HasForeignKey(x => x.DeploymentId).OnDelete(DeleteBehavior.Cascade);
                // Varias instancias RUNNING, como máximo UNA por versión (P1-07; antes una sola, GC-0004): dos
                // de la misma versión evaluarían dos veces. Lo garantiza la base —igual que la cuenta de
                // sistema— porque un lock en memoria no alcanza con dos procesos.
                e.HasIndex(x => x.VersionHash)
                 .IsUnique()
                 .HasFilter("lifecycle_state = 'RUNNING'")
                 .HasDatabaseName("ix_strategy_instances_running_version");
            });

            b.Entity<ShadowPositionEntity>(e =>
            {
                e.ToTable("shadow_positions");
                e.HasKey(x => x.Id);
                e.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
                e.Property(x => x.CandidateId).HasMaxLength(80).IsRequired();
                e.Property(x => x.Symbol).HasMaxLength(20).IsRequired();
                e.Property(x => x.Structure).HasMaxLength(40).IsRequired();
                e.Property(x => x.LegsJson).IsRequired();
                e.Property(x => x.Status).HasMaxLength(10).IsRequired();
                e.Property(x => x.ExitReason).HasMaxLength(20);
                e.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
                e.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");
                e.HasOne(x => x.Instance).WithMany().HasForeignKey(x => x.InstanceId).OnDelete(DeleteBehavior.Cascade);
                // El monitor pide las abiertas en cada tick; las métricas, todas las de una instancia.
                e.HasIndex(x => new { x.InstanceId, x.Status });
            });

            b.Entity<EvaluationLogEntity>(e =>
            {
                e.ToTable("evaluation_logs");
                e.HasKey(x => x.Id);
                e.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
                e.Property(x => x.Symbol).HasMaxLength(20).IsRequired();
                e.Property(x => x.ResultsJson).IsRequired();
                e.Property(x => x.EvaluatedAt).HasDefaultValueSql("now()");
                e.HasOne(x => x.Instance).WithMany().HasForeignKey(x => x.InstanceId).OnDelete(DeleteBehavior.Cascade);
                // Al arrancar se recargan las últimas de cada instancia, en su orden (GC-0004).
                e.Property(x => x.Seq).UseIdentityAlwaysColumn();
                e.HasIndex(x => new { x.InstanceId, x.EvaluatedAt, x.Seq });
            });

            b.Entity<OperationalEventEntity>(e =>
            {
                e.ToTable("operational_events");
                e.HasKey(x => x.Id);
                e.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
                e.Property(x => x.EventType).HasMaxLength(40).IsRequired();
                e.Property(x => x.Symbol).HasMaxLength(20);
                e.Property(x => x.PayloadJson).IsRequired();
                e.Property(x => x.Timestamp).HasDefaultValueSql("now()");
                e.HasOne(x => x.Instance).WithMany().HasForeignKey(x => x.InstanceId).OnDelete(DeleteBehavior.Cascade);
                e.Property(x => x.Seq).UseIdentityAlwaysColumn();
                e.HasIndex(x => new { x.InstanceId, x.Timestamp, x.Seq });
            });
            // Etapa y modo de cada estrategia (WS-0036): una fila por estrategia, con los valores válidos también en la base.
            b.Entity<StrategySettingEntity>(e =>
            {
                e.ToTable("strategy_settings", t =>
                {
                    t.HasCheckConstraint("ck_strategy_settings_stage", "stage IN ('" + string.Join("','", StrategySettingEntity.Stages) + "')");
                    t.HasCheckConstraint("ck_strategy_settings_mode", "mode IN ('" + string.Join("','", StrategySettingEntity.Modes) + "')");
                    t.HasCheckConstraint("ck_strategy_settings_live_auto", "NOT (stage = 'LIVE' AND mode = 'AUTO')");
                    t.HasCheckConstraint("ck_strategy_settings_shadow_auto", "NOT (stage = 'SHADOW' AND mode = 'MANUAL')");
                });
                e.HasKey(x => x.Name);
                e.Property(x => x.Name).HasMaxLength(100);
                e.Property(x => x.Stage).HasMaxLength(10).IsRequired();
                e.Property(x => x.Mode).HasMaxLength(10).IsRequired();
                e.Property(x => x.UpdatedBy).HasMaxLength(100).IsRequired();
            });
            // Espacio del trader (GC-0007): una pieza por (dueño, tipo, clave). Los tipos, la visibilidad y el formato
            // están también en la base porque una escritura a mano contra Postgres no pasa por la app.
            b.Entity<TraderSpaceItem>(e =>
            {
                e.ToTable("trader_space_items", t =>
                {
                    t.HasCheckConstraint("ck_trader_space_kind", "kind IN ('" + string.Join("','", TraderSpaceItem.Kinds) + "')");
                    t.HasCheckConstraint("ck_trader_space_visibility", "visibility IN ('" + string.Join("','", TraderSpaceItem.Visibilities) + "')");
                    t.HasCheckConstraint("ck_trader_space_format", "format IN ('" + string.Join("','", TraderSpaceItem.Formats) + "')");
                    t.HasCheckConstraint("ck_trader_space_key", "key ~ '" + TraderSpaceItem.KeyPattern + "'");
                });
                e.HasKey(x => x.Id);
                e.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
                e.Property(x => x.Kind).HasMaxLength(20).IsRequired();
                e.Property(x => x.Key).HasMaxLength(64).IsRequired();
                e.Property(x => x.Title).HasMaxLength(200).IsRequired();
                e.Property(x => x.Content).IsRequired();
                e.Property(x => x.Format).HasMaxLength(10).HasDefaultValue("markdown");
                e.Property(x => x.Visibility).HasMaxLength(10).HasDefaultValue("private");
                e.Property(x => x.Version).HasDefaultValue(1);
                e.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
                e.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");
                e.HasOne(x => x.Owner).WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Cascade);
                e.HasIndex(x => new { x.OwnerId, x.Kind, x.Key }).IsUnique();
                e.HasIndex(x => x.Visibility);
            });

        }
    }
}
