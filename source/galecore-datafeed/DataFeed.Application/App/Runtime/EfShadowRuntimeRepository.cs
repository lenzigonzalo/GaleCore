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

        public EfShadowRuntimeRepository(Func<GaleCoreDbContext> newContext) => _newContext = newContext;

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

        public void SaveInstance(StrategyInstance instance)
        {
            using var db = _newContext();
            var id = Guid.Parse(instance.InstanceId);
            var row = db.StrategyInstances.Find(id);
            if (row == null)
            {
                row = new StrategyInstanceEntity { Id = id, CreatedAt = Utc(instance.CreatedAt) };
                db.StrategyInstances.Add(row);
            }
            row.DeploymentId = Guid.Parse(instance.DeploymentId);
            row.VersionHash = instance.VersionHash;
            row.LifecycleState = instance.LifecycleState;
            row.SchedulerState = instance.SchedulerState;
            row.SpecName = instance.SpecName;
            row.Mode = instance.Mode;
            row.UpdatedAt = Utc(instance.UpdatedAt);
            db.SaveChanges();
        }

        public void SavePosition(ShadowPosition p)
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
            row.UpdatedAt = Utc(p.UpdatedAt);
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
            db.OperationalEvents.Add(new OperationalEventEntity
            {
                Id = id,
                InstanceId = Guid.Parse(e.InstanceId),
                EventType = e.EventType,
                Symbol = e.Symbol,
                PayloadJson = JsonConvert.SerializeObject(e.Payload),
                Timestamp = Utc(e.Timestamp),
            });
            db.SaveChanges();
        }

        // ── Lectura ────────────────────────────────────────────────

        public ShadowRuntimeSnapshot Load(int maxEvaluationsPerInstance, int maxEventsPerInstance)
        {
            using var db = _newContext();
            var instances = db.StrategyInstances.AsNoTracking().OrderBy(i => i.CreatedAt).ToList();
            var snapshot = new ShadowRuntimeSnapshot
            {
                Instances = instances.Select(ToContract).ToList(),
                Positions = db.ShadowPositions.AsNoTracking().OrderBy(p => p.EntryAt).AsEnumerable().Select(ToContract).ToList(),
            };
            foreach (var i in instances)
            {
                snapshot.Evaluations.AddRange(db.EvaluationLogs.AsNoTracking().Where(e => e.InstanceId == i.Id)
                    .OrderByDescending(e => e.EvaluatedAt).Take(maxEvaluationsPerInstance)
                    .AsEnumerable().Reverse().Select(ToContract));
                snapshot.Events.AddRange(db.OperationalEvents.AsNoTracking().Where(e => e.InstanceId == i.Id)
                    .OrderByDescending(e => e.Timestamp).Take(maxEventsPerInstance)
                    .AsEnumerable().Reverse().Select(ToContract));
            }
            return snapshot;
        }

        public string? GetSpecJson(string contentHash)
        {
            using var db = _newContext();
            return db.StrategySpecs.AsNoTracking().Where(s => s.ContentHash == contentHash).Select(s => s.SpecJson).FirstOrDefault();
        }

        public IReadOnlyList<SpecVersionRecord> LoadMetricsInputs()
        {
            using var db = _newContext();
            var records = new List<SpecVersionRecord>();
            foreach (var group in db.StrategyInstances.AsNoTracking().ToList().GroupBy(i => i.VersionHash).OrderBy(g => g.Min(i => i.CreatedAt)))
            {
                var hash = group.Key;
                var ids = group.Select(i => i.Id).ToList();
                var spec = db.StrategySpecs.AsNoTracking().FirstOrDefault(s => s.ContentHash == hash);
                var evals = db.EvaluationLogs.AsNoTracking().Where(e => ids.Contains(e.InstanceId));
                records.Add(new SpecVersionRecord
                {
                    ContentHash = hash,
                    SpecName = spec?.Name ?? group.First().SpecName,
                    SpecVersion = spec?.Version ?? "",
                    Instances = ids.Count,
                    Evaluations = evals.Count(),
                    EvaluationsPassed = evals.Count(e => e.OverallPass),
                    FirstEvaluationAt = evals.Min(e => (DateTime?)e.EvaluatedAt),
                    LastEvaluationAt = evals.Max(e => (DateTime?)e.EvaluatedAt),
                    EventCounts = db.OperationalEvents.AsNoTracking().Where(e => ids.Contains(e.InstanceId))
                        .GroupBy(e => e.EventType).Select(g => new { g.Key, Count = g.Count() })
                        .ToDictionary(x => x.Key, x => x.Count),
                    Positions = db.ShadowPositions.AsNoTracking().Where(p => ids.Contains(p.InstanceId))
                        .AsEnumerable().Select(ToContract).ToList(),
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
