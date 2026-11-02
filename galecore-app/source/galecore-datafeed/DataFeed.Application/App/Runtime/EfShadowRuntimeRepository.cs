using DataFeed.Application.App.Runtime.Contracts;
using DataFeed.Repositories;
using DataFeed.Repositories.Entities;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;

namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// Persistencia del runtime SHADOW en PostgreSQL con EF Core (GC-0004), sobre las tablas de
    /// GaleCoreDbContext que existían sin uso desde el checkpoint del runtime.
    ///
    /// Un DbContext por operación: los dos loops escriben en paralelo y un DbContext no es thread-safe.
    /// Las escrituras son idempotentes por identidad (el id del contrato es la clave primaria), así
    /// que reintentar o recargar no duplica filas. Los ids de los contratos son GUIDs en texto.
    ///
    /// JSON con Newtonsoft, el mismo serializador de la API: el payload de un evento vuelve como JToken
    /// y la API lo devuelve tal cual se guardó.
    /// </summary>
    public class EfShadowRuntimeRepository : IShadowRuntimeRepository
    {
        private readonly Func<GaleCoreDbContext> _newContext;
        private readonly ShadowRuntimeOwner _owner;

        /// <summary>Con `owner` fijado, todo lo que se lee es sólo de las instancias desplegadas por ese usuario.</summary>
        public EfShadowRuntimeRepository(Func<GaleCoreDbContext> newContext, ShadowRuntimeOwner? owner = null)
        {
            _newContext = newContext;
            _owner = owner ?? new ShadowRuntimeOwner(null);
        }

        /// <summary>Las instancias de este runtime: todas, o sólo las del dueño (por DeployedBy de su deployment).</summary>
        private IQueryable<StrategyInstanceEntity> OwnedInstances(GaleCoreDbContext db)
        {
            if (!_owner.IsScoped) return db.StrategyInstances;
            var by = ShadowRuntimeOwner.DeployedByOf(_owner.UserId);
            return db.StrategyInstances.Where(i => db.StrategyDeployments.Any(d => d.Id == i.DeploymentId && d.DeployedBy == by));
        }

        // ── Escritura ──────────────────────────────────────────────

        public void SaveSpec(StrategySpec spec, string specJson)
        {
            var hash = spec.ContentHash ?? throw new ArgumentException("la spec no tiene content hash", nameof(spec));
            using var db = _newContext();
            if (db.StrategySpecs.Any(s => s.ContentHash == hash)) return;
            db.StrategySpecs.Add(new StrategySpecEntity
            {
                Name = spec.Identity.Name,
                DisplayName = spec.Identity.DisplayName,
                Version = spec.Identity.Version,
                ContentHash = hash,
                SpecJson = specJson,
            });
            db.SaveChanges();
        }

        public void SaveDeployment(StrategyDeployment deployment)
        {
            using var db = _newContext();
            var id = Guid.Parse(deployment.DeploymentId);
            if (db.StrategyDeployments.Any(d => d.Id == id)) return;
            var specId = db.StrategySpecs.Where(s => s.ContentHash == deployment.VersionHash).Select(s => (Guid?)s.Id).FirstOrDefault()
                ?? throw new InvalidOperationException($"la spec {deployment.VersionHash} no está guardada");
            db.StrategyDeployments.Add(new StrategyDeploymentEntity
            {
                Id = id,
                SpecId = specId,
                VersionHash = deployment.VersionHash,
                Mode = deployment.Mode,
                DeployedBy = deployment.DeployedBy,
                DeployedAt = Utc(deployment.DeployedAt),
            });
            db.SaveChanges();
        }

        public StrategyInstance? Deploy(StrategyDeployment deployment, StrategyInstance instance, OperationalEvent created)
        {
            using (var db = _newContext())
            {
                var specId = db.StrategySpecs.Where(s => s.ContentHash == deployment.VersionHash).Select(s => (Guid?)s.Id).FirstOrDefault()
                    ?? throw new InvalidOperationException($"la spec {deployment.VersionHash} no está guardada");
                db.StrategyDeployments.Add(new StrategyDeploymentEntity
                {
                    Id = Guid.Parse(deployment.DeploymentId),
                    SpecId = specId,
                    VersionHash = deployment.VersionHash,
                    Mode = deployment.Mode,
                    DeployedBy = deployment.DeployedBy,
                    DeployedAt = Utc(deployment.DeployedAt),
                });
                db.StrategyInstances.Add(new StrategyInstanceEntity
                {
                    Id = Guid.Parse(instance.InstanceId),
                    DeploymentId = Guid.Parse(instance.DeploymentId),
                    VersionHash = instance.VersionHash,
                    LifecycleState = instance.LifecycleState,
                    SchedulerState = instance.SchedulerState,
                    SpecName = instance.SpecName,
                    Mode = instance.Mode,
                    DeployedBy = deployment.DeployedBy,
                    CreatedAt = Utc(instance.CreatedAt),
                    UpdatedAt = Utc(instance.UpdatedAt),
                });
                db.OperationalEvents.Add(ToEntity(created));
                try
                {
                    db.SaveChanges();   // una transacción: los tres o ninguno
                    return null;
                }
                catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: "23505", ConstraintName: "ix_strategy_instances_running_version" })
                {
                    // Otro proceso del mismo dueño ganó: no queda nada de este intento; se devuelve la suya.
                }
            }
            using var read = _newContext();
            var running = read.StrategyInstances.AsNoTracking()
                .FirstOrDefault(i => i.VersionHash == instance.VersionHash && i.LifecycleState == "RUNNING" && i.DeployedBy == deployment.DeployedBy);
            if (running == null)
                throw new InvalidOperationException($"la base rechazó la instancia de {instance.VersionHash} pero no hay otra RUNNING");
            return ToContract(running);
        }

        public void SaveInstance(StrategyInstance instance)
        {
            using var db = _newContext();
            var id = Guid.Parse(instance.InstanceId);
            var row = db.StrategyInstances.Find(id);
            if (row == null)
            {
                var deploymentId = Guid.Parse(instance.DeploymentId);
                var deployedBy = db.StrategyDeployments.Where(d => d.Id == deploymentId).Select(d => d.DeployedBy).FirstOrDefault();
                row = new StrategyInstanceEntity { Id = id, CreatedAt = Utc(instance.CreatedAt), DeployedBy = deployedBy ?? "SYSTEM" };
                db.StrategyInstances.Add(row);
            }
            row.DeploymentId = Guid.Parse(instance.DeploymentId);
            row.VersionHash = instance.VersionHash;
            row.LifecycleState = instance.LifecycleState;
            row.SchedulerState = instance.SchedulerState;
            row.SpecName = instance.SpecName;
            row.Mode = instance.Mode;
            row.UpdatedAt = Utc(instance.UpdatedAt);
            try
            {
                db.SaveChanges();
            }
            catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: "23505", ConstraintName: "ix_strategy_instances_running_version" })
            {
                throw new ShadowRuntimeConflictException("ya hay una instancia SHADOW RUNNING de esta versión en la base", ex);
            }
        }

        public void SavePosition(ShadowPosition p, OperationalEvent? lifecycleEvent = null)
        {
            using var db = _newContext();
            var id = Guid.Parse(p.PositionId);
            var row = db.ShadowPositions.Find(id);
            if (row == null)
            {
                row = new ShadowPositionEntity { Id = id, CreatedAt = Utc(p.CreatedAt) };
                db.ShadowPositions.Add(row);
            }
            row.InstanceId = Guid.Parse(p.InstanceId);
            row.CandidateId = p.CandidateId;
            row.Symbol = p.Symbol;
            row.Structure = p.Structure;
            row.LegsJson = JsonConvert.SerializeObject(p.Legs);
            row.Status = p.Status;
            row.EntryCredit = p.EntryCredit;
            row.MaxRisk = p.MaxRisk;
            row.Width = p.Width;
            row.EntryDte = p.EntryDte;
            row.EntryAt = Utc(p.EntryAt);
            row.ExitDebit = p.ExitDebit;
            row.ExitAt = UtcOrNull(p.ExitAt);
            row.ExitReason = p.ExitReason;
            row.RealizedPnl = p.RealizedPnl;
            row.UnrealizedPnl = p.UnrealizedPnl;
            row.LastSpreadValue = p.LastSpreadValue;
            row.CurrentDte = p.CurrentDte;
            row.LastValuedAt = UtcOrNull(p.LastValuedAt);
            row.ValuationProblemsJson = p.ValuationProblems == null ? null : JsonConvert.SerializeObject(p.ValuationProblems);
            row.EntryContextJson = p.EntryContext == null ? null : JsonConvert.SerializeObject(p.EntryContext);
            row.ExitContextJson = p.ExitContext == null ? null : JsonConvert.SerializeObject(p.ExitContext);
            row.UpdatedAt = Utc(p.UpdatedAt);
            // Un solo SaveChanges = una transacción: la posición y su evento quedan juntos o no queda ninguno.
            if (lifecycleEvent != null)
            {
                var eventId = Guid.Parse(lifecycleEvent.EventId);
                if (!db.OperationalEvents.Any(x => x.Id == eventId)) db.OperationalEvents.Add(ToEntity(lifecycleEvent));
            }
            db.SaveChanges();
        }

        public void AddEvaluation(EvaluationResult e)
        {
            using var db = _newContext();
            var id = Guid.Parse(e.EvaluationId);
            if (db.EvaluationLogs.Any(x => x.Id == id)) return;
            db.EvaluationLogs.Add(new EvaluationLogEntity
            {
                Id = id,
                InstanceId = Guid.Parse(e.InstanceId),
                Symbol = e.Symbol,
                OverallPass = e.OverallPass,
                ResultsJson = JsonConvert.SerializeObject(e.GateResults),
                EvaluatedAt = Utc(e.EvaluatedAt),
            });
            db.SaveChanges();
        }

        public void AddEvent(OperationalEvent e)
        {
            using var db = _newContext();
            var id = Guid.Parse(e.EventId);
            if (db.OperationalEvents.Any(x => x.Id == id)) return;
            db.OperationalEvents.Add(ToEntity(e));
            db.SaveChanges();
        }

        private static OperationalEventEntity ToEntity(OperationalEvent e) => new()
        {
            Id = Guid.Parse(e.EventId),
            InstanceId = Guid.Parse(e.InstanceId),
            EventType = e.EventType,
            Symbol = e.Symbol,
            PayloadJson = JsonConvert.SerializeObject(e.Payload),
            Timestamp = Utc(e.Timestamp),
        };

        // ── Lectura ────────────────────────────────────────────────

        public ShadowRuntimeSnapshot Load(int maxEvaluationsPerInstance, int maxEventsPerInstance)
        {
            using var db = _newContext();
            var instances = OwnedInstances(db).AsNoTracking().OrderBy(i => i.CreatedAt).ToList();
            var ownedIds = instances.Select(i => i.Id).ToList();
            var positions = db.ShadowPositions.AsNoTracking();
            if (_owner.IsScoped) positions = positions.Where(p => ownedIds.Contains(p.InstanceId));
            var snapshot = new ShadowRuntimeSnapshot
            {
                Instances = instances.Select(ToContract).ToList(),
                Positions = positions.OrderBy(p => p.EntryAt).AsEnumerable().Select(ToContract).ToList(),
            };
            foreach (var i in instances)
            {
                snapshot.Evaluations.AddRange(db.EvaluationLogs.AsNoTracking().Where(e => e.InstanceId == i.Id)
                    .OrderByDescending(e => e.EvaluatedAt).ThenByDescending(e => e.Seq).Take(maxEvaluationsPerInstance)
                    .AsEnumerable().Reverse().Select(ToContract));
                // Los de ciclo de vida vuelven todos (el store no los descarta nunca); del resto, los últimos N.
                var lifecycle = ShadowRuntimeStore.LifecycleEventTypes.ToList();
                var events = db.OperationalEvents.AsNoTracking().Where(e => e.InstanceId == i.Id);
                var kept = events.Where(e => lifecycle.Contains(e.EventType)).ToList();
                kept.AddRange(events.Where(e => !lifecycle.Contains(e.EventType))
                    .OrderByDescending(e => e.Timestamp).ThenByDescending(e => e.Seq).Take(maxEventsPerInstance).ToList());
                snapshot.Events.AddRange(kept.OrderBy(e => e.Timestamp).ThenBy(e => e.Seq).Select(ToContract));
            }
            return snapshot;
        }

        public string? GetSpecJson(string contentHash)
        {
            using var db = _newContext();
            return db.StrategySpecs.AsNoTracking().Where(s => s.ContentHash == contentHash).Select(s => s.SpecJson).FirstOrDefault();
        }

        public IReadOnlyList<SpecVersionRecord> LoadMetricsInputs(string? specName = null)
        {
            using var db = _newContext();
            // Cinco viajes a la base en total, no varios por versión: contra Supabase Dev cada viaje cuesta (WS-0036).
            var instances = OwnedInstances(db).AsNoTracking().Where(i => specName == null || i.SpecName == specName).ToList();
            if (instances.Count == 0) return new List<SpecVersionRecord>();
            var ids = instances.Select(i => i.Id).ToList();
            var hashes = instances.Select(i => i.VersionHash).Distinct().ToList();
            var specs = db.StrategySpecs.AsNoTracking().Where(s => hashes.Contains(s.ContentHash))
                .Select(s => new { s.ContentHash, s.Name, s.Version }).ToList()
                .GroupBy(s => s.ContentHash).ToDictionary(g => g.Key, g => g.First());
            var evals = db.EvaluationLogs.AsNoTracking().Where(e => ids.Contains(e.InstanceId))
                .GroupBy(e => e.InstanceId).Select(g => new
                {
                    InstanceId = g.Key, Count = g.Count(), Passed = g.Count(e => e.OverallPass),
                    First = g.Min(e => (DateTime?)e.EvaluatedAt), Last = g.Max(e => (DateTime?)e.EvaluatedAt),
                }).ToList().ToDictionary(e => e.InstanceId);
            var events = db.OperationalEvents.AsNoTracking().Where(e => ids.Contains(e.InstanceId))
                .GroupBy(e => new { e.InstanceId, e.EventType }).Select(g => new { g.Key.InstanceId, g.Key.EventType, Count = g.Count() })
                .ToList();
            var positions = db.ShadowPositions.AsNoTracking().Where(p => ids.Contains(p.InstanceId)).ToList()
                .ToLookup(p => p.InstanceId);

            var records = new List<SpecVersionRecord>();
            foreach (var group in instances.GroupBy(i => i.VersionHash).OrderBy(g => g.Min(i => i.CreatedAt)))
            {
                var hash = group.Key;
                var groupIds = group.Select(i => i.Id).ToHashSet();
                specs.TryGetValue(hash, out var spec);
                var groupEvals = groupIds.Where(evals.ContainsKey).Select(id => evals[id]).ToList();
                records.Add(new SpecVersionRecord
                {
                    ContentHash = hash,
                    SpecName = spec?.Name ?? group.First().SpecName,
                    SpecVersion = spec?.Version ?? "",
                    Instances = groupIds.Count,
                    Evaluations = groupEvals.Sum(e => e.Count),
                    EvaluationsPassed = groupEvals.Sum(e => e.Passed),
                    FirstEvaluationAt = groupEvals.Min(e => e.First),
                    LastEvaluationAt = groupEvals.Max(e => e.Last),
                    EventCounts = events.Where(e => groupIds.Contains(e.InstanceId))
                        .GroupBy(e => e.EventType).ToDictionary(g => g.Key, g => g.Sum(e => e.Count)),
                    Positions = groupIds.SelectMany(id => positions[id]).Select(ToContract).ToList(),
                });
            }
            return records;
        }

        // ── Mapeo ──────────────────────────────────────────────────

        private static StrategyInstance ToContract(StrategyInstanceEntity i) => new()
        {
            InstanceId = i.Id.ToString(),
            DeploymentId = i.DeploymentId.ToString(),
            VersionHash = i.VersionHash,
            LifecycleState = i.LifecycleState,
            SchedulerState = i.SchedulerState,
            SpecName = i.SpecName,
            Mode = i.Mode,
            DeployedBy = i.DeployedBy,
            CreatedAt = Utc(i.CreatedAt),
            UpdatedAt = Utc(i.UpdatedAt),
        };

        private static ShadowPosition ToContract(ShadowPositionEntity p) => new()
        {
            PositionId = p.Id.ToString(),
            InstanceId = p.InstanceId.ToString(),
            CandidateId = p.CandidateId,
            Symbol = p.Symbol,
            Structure = p.Structure,
            Legs = JsonConvert.DeserializeObject<List<ShadowLeg>>(p.LegsJson) ?? new(),
            Status = p.Status,
            EntryCredit = p.EntryCredit,
            MaxRisk = p.MaxRisk,
            Width = p.Width,
            EntryDte = p.EntryDte,
            EntryAt = Utc(p.EntryAt),
            ExitDebit = p.ExitDebit,
            ExitAt = UtcOrNull(p.ExitAt),
            ExitReason = p.ExitReason,
            RealizedPnl = p.RealizedPnl,
            UnrealizedPnl = p.UnrealizedPnl,
            LastSpreadValue = p.LastSpreadValue,
            CurrentDte = p.CurrentDte,
            LastValuedAt = UtcOrNull(p.LastValuedAt),
            ValuationProblems = p.ValuationProblemsJson == null ? null : JsonConvert.DeserializeObject<List<string>>(p.ValuationProblemsJson),
            EntryContext = p.EntryContextJson == null ? null : JsonConvert.DeserializeObject<EntryContext>(p.EntryContextJson),
            ExitContext = p.ExitContextJson == null ? null : JsonConvert.DeserializeObject<ExitContext>(p.ExitContextJson),
            CreatedAt = Utc(p.CreatedAt),
            UpdatedAt = Utc(p.UpdatedAt),
        };

        private static EvaluationResult ToContract(EvaluationLogEntity e) => new()
        {
            EvaluationId = e.Id.ToString(),
            InstanceId = e.InstanceId.ToString(),
            Symbol = e.Symbol,
            OverallPass = e.OverallPass,
            GateResults = JsonConvert.DeserializeObject<List<GateResult>>(e.ResultsJson) ?? new(),
            EvaluatedAt = Utc(e.EvaluatedAt),
        };

        private static OperationalEvent ToContract(OperationalEventEntity e) => new()
        {
            EventId = e.Id.ToString(),
            InstanceId = e.InstanceId.ToString(),
            EventType = e.EventType,
            Symbol = e.Symbol,
            Payload = JsonConvert.DeserializeObject<Dictionary<string, object?>>(e.PayloadJson) ?? new(),
            Timestamp = Utc(e.Timestamp),
        };

        // timestamptz exige DateTime en UTC; un valor sin Kind se toma como UTC (así lo produce el runtime).
        private static DateTime Utc(DateTime d) => d.Kind switch
        {
            DateTimeKind.Utc => d,
            DateTimeKind.Local => d.ToUniversalTime(),
            _ => DateTime.SpecifyKind(d, DateTimeKind.Utc),
        };

        private static DateTime? UtcOrNull(DateTime? d) => d == null ? null : Utc(d.Value);
    }
}
