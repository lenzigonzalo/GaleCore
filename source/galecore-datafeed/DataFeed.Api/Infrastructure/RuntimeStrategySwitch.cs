namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Switch ON/OFF del Trading Runtime SHADOW. Delegado a PlatformServiceSwitch con id "runtime",
    /// porque el runtime se declara en services[] de galecore_rules_core.json (visible en Main con
    /// ServiceCard). Arranca OFF por defecto (enabled: false en services[]).
    ///
    /// Los loops consultan Resolve() en cada tick; el endpoint es el genérico
    /// /App/GaleCore/Services/runtime/Switch, que ya existe para todos los servicios.
    /// </summary>
    public class RuntimeStrategySwitch
    {
        private readonly PlatformServiceSwitch _serviceSwitch;
        private const string ServiceId = "runtime";

        public RuntimeStrategySwitch(PlatformServiceSwitch serviceSwitch)
        {
            _serviceSwitch = serviceSwitch;
        }

        /// <summary>Nivel de reglas: lo que declara services[].enabled en la config.</summary>
        public bool RulesEnabled => _serviceSwitch.ReadRulesEnabled(ServiceId) ?? false;

        /// <summary>Override del operador, o null si nunca se tocó.</summary>
        public bool? ReadOverride() => _serviceSwitch.ReadOverride(ServiceId);

        /// <summary>Estado efectivo resuelto.</summary>
        public (bool Enabled, string Source) Resolve()
            => _serviceSwitch.Resolve(ServiceId) ?? (false, "rules");

        public void Set(bool enabled) => _serviceSwitch.Set(ServiceId, enabled);
    }
}
