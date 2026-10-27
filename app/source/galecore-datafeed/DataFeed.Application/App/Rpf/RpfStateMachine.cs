namespace DataFeed.Application.App.Rpf
{
    /// <summary>
    /// Inputs resueltos de la máquina de estados. El loop los deriva de la respuesta de la cascada
    /// (macro_regime + signal_gates + risk_and_sizing) + el store (cooldown).
    /// Mantener este tipo "plano" — sin lógica — es lo que hace a RpfStateMachine una función pura testeable.
    /// </summary>
    public record RpfStateInputs
    {
        /// <summary>Hay al menos una posición abierta del símbolo (fuente: posiciones de cuenta).</summary>
        public bool HasOpenPosition { get; init; }

        /// <summary>Score de cola del gate tail_score. Se ignora si !TailScoreAvailable.</summary>
        public int TailScore { get; init; }

        /// <summary>El gate tail_score corrió con datos. Si false, no se puede afirmar VETOED.</summary>
        public bool TailScoreAvailable { get; init; }

        /// <summary>Tier A completo pasa: macro_regime (VIX/TS/IVmom/GEX≥0) ∧ VRP≥1.2 ∧ tail_score&lt;2.</summary>
        public bool TierAPass { get; init; }

        /// <summary>edge_emp ≥ barra del régimen (gate edge).</summary>
        public bool EdgePass { get; init; }

        /// <summary>Hay cupo para abrir: posiciones disponibles (V2 ≤ 2) ∧ heat OK.</summary>
        public bool CapacityAvailable { get; init; }

        /// <summary>El símbolo está en la ventana de cooldown anti-doble-emisión (store).</summary>
        public bool InCooldown { get; init; }
    }

    /// <summary>
    /// Máquina de estados RPF por símbolo (diseño Fase 5 §4). Función PURA, sin estado ni infra:
    /// dado el snapshot de inputs, devuelve el estado.
    ///
    /// Precedencia (el primero que matchea gana):
    /// VETOED → WAITING_CAPACITY → IN_POSITION → DORMANT → ARMED → COOLDOWN → TRIGGERED.
    ///
    /// Dos decisiones del operador (2026-07-29) que fijan la semántica frente a la cartera V2:
    /// 1. <b>IN_POSITION = libro lleno y sin trigger vivo</b> (solo queda gestionar). NO es "cualquier
    ///    posición abierta": con 1 de 2 cupos el sistema sigue armando para la 2ª posición, que es
    ///    justamente lo que V2 valida (BT-15). Con el libro lleno y el edge cruzando la barra el estado
    ///    es WAITING_CAPACITY — por eso ese estado va antes en la precedencia.
    /// 2. <b>VETOED gana sobre IN_POSITION</b>: el peligro activo domina la lectura (safety-first,
    ///    principio §1.1). La gestión de la posición abierta sigue corriendo por trade_management;
    ///    el estado solo comunica el entorno.
    ///
    /// NO decide transiciones ni efectos (emitir sugerencia, arrancar cooldown): eso es del loop/store.
    /// </summary>
    public static class RpfStateMachine
    {
        public static RpfState Evaluate(RpfStateInputs inp)
        {
            // Autoridad: veto de cola activo. Solo afirmable si el gate tail corrió con datos
            // (si el macro cortó la cascada antes, no se puede afirmar VETOED).
            if (inp.TailScoreAvailable && inp.TailScore >= 2) return RpfState.Vetoed;

            // Trigger vivo = el entorno habilita Y el edge cruza la barra.
            bool triggerLive = inp.TierAPass && inp.EdgePass;

            if (!inp.CapacityAvailable)
            {
                // Sin cupo: si hay un trade que cruza la barra, se señaliza aunque no se pueda abrir.
                if (triggerLive) return RpfState.WaitingCapacity;
                // Sin trigger vivo: si el libro está lleno solo queda gestionar; si no hay posiciones
                // (cupo bloqueado por heat), no es IN_POSITION — es simplemente no operable.
                return inp.HasOpenPosition ? RpfState.InPosition : RpfState.Dormant;
            }

            // Con cupo disponible: manda el entorno y después el edge.
            if (!inp.TierAPass) return RpfState.Dormant;
            if (!inp.EdgePass) return RpfState.Armed;
            if (inp.InCooldown) return RpfState.Cooldown;

            // Tier A ∧ edge ≥ barra ∧ cupo ∧ sin cooldown → dispara.
            return RpfState.Triggered;
        }
    }
}
