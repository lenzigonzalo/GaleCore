namespace DataFeed.Application.App.Rpf
{
    /// <summary>
    /// Estados de la máquina RPF por símbolo (definición §8 / diseño Fase 5).
    /// El orden del enum NO es la precedencia — la precedencia la aplica RpfStateMachine.
    /// </summary>
    public enum RpfState
    {
        InPosition,
        Vetoed,
        Dormant,
        Armed,
        WaitingCapacity,
        Cooldown,
        Triggered,
    }

    public static class RpfStateExtensions
    {
        /// <summary>Nombre canónico (UPPER) que espeja state_machine.states del JSON y viaja al tablero.</summary>
        public static string ToWire(this RpfState state) => state switch
        {
            RpfState.InPosition => "IN_POSITION",
            RpfState.Vetoed => "VETOED",
            RpfState.Dormant => "DORMANT",
            RpfState.Armed => "ARMED",
            RpfState.WaitingCapacity => "WAITING_CAPACITY",
            RpfState.Cooldown => "COOLDOWN",
            RpfState.Triggered => "TRIGGERED",
            _ => "DORMANT",
        };
    }
}
