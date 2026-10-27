namespace DataFeed.Application.App.Rpf.Engine
{
    /// <summary>
    /// Resolución PURA del cortocircuito de la SEÑAL RPF → (OverallSignal, FailedAtLayer). Solo "NO_OPERAR"
    /// corta; "ESPERAR" (macro con 1 check flojo) se propaga como veredicto pero no frena; los signal_gates
    /// cuentan como capa 2 del embudo de strikes. El cupo/sizing NO entra: es ortogonal a la validez de la
    /// señal (lo lee la máquina de estados como CapacityAvailable → WaitingCapacity). Función pura y
    /// determinista, congelada por tests sin mockear providers.
    /// </summary>
    public static class RpfCascadeResolver
    {
        /// <param name="gatesAllPass">Resultado de los signal_gates. Solo se consulta si macro/strike/micro pasaron.</param>
        public static (string overall, int? failedAtLayer) Resolve(
            string macroSignal, string strikeSignal, string microSignal, bool gatesAllPass)
        {
            if (macroSignal == "NO_OPERAR") return ("NO_OPERAR", 1);

            string cut = macroSignal == "ESPERAR" ? "ESPERAR" : "NO_OPERAR";
            if (strikeSignal == "NO_OPERAR") return (cut, 2);
            if (microSignal == "NO_OPERAR") return (cut, 3);

            // macro+strike+micro OK → los gates (seguridad + dispara) deciden. Si fallan, cortan como capa 2
            // (embudo de strikes). El cupo no participa: es ortogonal (lo comunica el estado).
            if (!gatesAllPass) return ("NO_OPERAR", 2);

            return (macroSignal, null);
        }
    }
}
