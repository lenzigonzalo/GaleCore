namespace DataFeed.Application.App.Runtime
{
    /// <summary>Qué hizo POST /App/Runtime/Specs: el controller sólo lo traduce a HTTP.</summary>
    public record SpecRegisterOutcome(
        string Kind, IReadOnlyList<string> Errors, string? Name, string? ContentHash, string? ReplacedHash, string? Message, string? RunningInstanceId, string? RunningHash)
    {
        public const string KindRegistered = "REGISTERED", KindInvalid = "INVALID", KindConflict = "CONFLICT", KindNoPersistence = "NO_PERSISTENCE";
    }

    /// <summary>
    /// POST /App/Runtime/Specs (WS-0062 inc.11): registra en el store una spec aprobada, sin reinicio. Valida con el mismo cargador que el
    /// arranque y el Check (mismos errores, mismo hash). No escribe archivos: queda en memoria y se guarda en la base al desplegarla.
    /// </summary>
    public static class StrategySpecRegistrar
    {
        public static SpecRegisterOutcome Register(ShadowRuntimeStore store, string specJson, bool persistenceAvailable, string? persistenceReason)
        {
            var load = StrategySpecLoader.LoadFromJson(specJson);
            if (!load.Success || load.Spec == null)
                return new(SpecRegisterOutcome.KindInvalid, load.Errors, null, null, null, null, null, null);

            // Igual que el Deploy: sin persistencia no se registra nada que no se pueda desplegar.
            if (!persistenceAvailable || !store.IsDurable)
                return new(SpecRegisterOutcome.KindNoPersistence, Array.Empty<string>(), null, null, null,
                    $"SHADOW sin persistencia: no se registra una spec que no se podría desplegar. {persistenceReason}".Trim(), null, null);

            var spec = load.Spec;
            var result = store.TryRegisterSpec(spec, load.Json ?? specJson);
            if (result.Kind == SpecRegistration.KindConflict)
                return new(SpecRegisterOutcome.KindConflict, Array.Empty<string>(), spec.Identity.Name, spec.ContentHash, null,
                    $"'{spec.Identity.Name}' corre con otra versión ({result.Running!.VersionHash}): una versión nueva no pisa a la que corre; primero se frena la instancia {result.Running.InstanceId}.",
                    result.Running.InstanceId, result.Running.VersionHash);

            return new(SpecRegisterOutcome.KindRegistered, Array.Empty<string>(), spec.Identity.Name, spec.ContentHash, result.ReplacedHash, null, null, null);
        }
    }
}
