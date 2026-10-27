namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    /// <summary>
    /// Resultado de suscripción masiva a Greeks + Candle (OI) para múltiples opciones.
    /// Greeks provee IV/delta/gamma en tiempo real; Candle provee OpenInterest del cierre anterior.
    /// </summary>
    public class MultiGreeksModel
    {
        /// <summary>Greeks por símbolo streamer (sin sufijos de evento)</summary>
        public Dictionary<string, GreeksEvent> Greeks { get; set; } = new();

        /// <summary>OpenInterest por símbolo streamer, obtenido del candle diario</summary>
        public Dictionary<string, long> OpenInterest { get; set; } = new();

        /// <summary>Cierre del período anterior (close del candle diario) por símbolo streamer</summary>
        public Dictionary<string, double> PrevClose { get; set; } = new();

        /// <summary>
        /// Cuántos símbolos se pidieron. Contra <c>Greeks.Count</c> da la cobertura real del
        /// snapshot: un símbolo sin Greeks no aporta al GEX, y sin este número la falta es invisible.
        /// </summary>
        public int SymbolsRequested { get; set; }

        /// <summary>
        /// Símbolos a los que se les pidió OI (los que tienen Greeks y caen en la banda de |delta|).
        /// Contra <c>OpenInterest</c> da la cobertura del OI: un OI que no volvió cuenta como cero en
        /// el GEX y, sin esto, no se distingue de un cero real.
        /// </summary>
        public HashSet<string> OiRequested { get; set; } = new();
    }
}
