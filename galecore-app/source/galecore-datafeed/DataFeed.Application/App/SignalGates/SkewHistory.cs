using System.Globalization;
using System.Text.Json.Nodes;

namespace DataFeed.Application.App.SignalGates
{
    /// <summary>
    /// Lectura de la historia diaria de skew25 (Files/skew25_history.json), persistida por
    /// SkewSnapshotService. Formato:
    /// <c>{ "SPY": [ {"date":"2026-07-20","skew25":1.14,"expiration":"2026-08-21","dte":32}, ... ] }</c>
    /// ascendente por fecha. De ahí sale el RoC 5d del componente skew del gate tail_score:
    /// <c>roc = skew25_live / skew25(hace 5 sesiones) - 1</c>.
    ///
    /// Dos defensas, las dos por defectos que la serie tuvo de verdad (auditada el 2026-08-25):
    ///
    /// <list type="number">
    /// <item><b>Se descartan los puntos de fin de semana.</b> El servicio fechaba en UTC y no miraba
    /// el calendario, así que quedó un punto el domingo 2026-08-23 y otro el lunes 24 con el mismo
    /// valor a cuatro decimales en los dos símbolos: el mismo dato viejo escrito dos veces. Como el
    /// conteo de "sesiones" era posicional, ese punto corría la ventana del RoC. Filtrar al leer
    /// arregla la lectura sin borrar historia, que es irreversible.</item>
    /// <item><b>El RoC se anula si los dos extremos no miden el mismo plazo.</b> El skew es función
    /// del DTE, así que comparar un punto de DTE 35 contra uno de DTE 59 mide el cambio de
    /// vencimiento, no el de la cola — es lo que pasó el 2026-08-18, con un escalón de +0.038 en SPY
    /// y +0.034 en QQQ el mismo día en los dos símbolos.</item>
    /// </list>
    ///
    /// Los puntos viejos no tienen <c>dte</c>. Frente a uno de esos, con un DTE vivo conocido, el
    /// RoC devuelve null: no se puede saber si son comparables, y un null degrada a "sin dato" en el
    /// gate, que es lo correcto. Se cura solo en cuanto la serie acumula cinco puntos nuevos.
    /// </summary>
    public sealed class SkewHistory
    {
        /// <summary>Diferencia de DTE tolerada entre los dos extremos del RoC.</summary>
        public const int DteToleranceDays = 7;

        public sealed record Point(DateTime Date, double Skew25, int? Dte);

        private readonly Dictionary<string, List<Point>> _bySymbol; // ascendente por fecha

        private SkewHistory(Dictionary<string, List<Point>> bySymbol) => _bySymbol = bySymbol;

        public static SkewHistory Parse(string json)
        {
            var map = new Dictionary<string, List<Point>>(StringComparer.OrdinalIgnoreCase);
            var root = JsonNode.Parse(json)?.AsObject();
            if (root != null)
            {
                foreach (var kvp in root)
                {
                    var rows = kvp.Value?.AsArray();
                    if (rows == null) continue;
                    var pts = new List<Point>();
                    foreach (var r in rows)
                    {
                        double? s = r?["skew25"]?.GetValue<double>();
                        if (s is not > 0) continue;

                        // Sin fecha legible no se puede saber si es una sesión: se descarta.
                        if (!DateTime.TryParseExact((string?)r?["date"], "yyyy-MM-dd",
                                CultureInfo.InvariantCulture, DateTimeStyles.None, out var fecha))
                            continue;
                        if (fecha.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) continue;

                        int? dte = r?["dte"]?.GetValue<int>();
                        pts.Add(new Point(fecha, s.Value, dte is > 0 ? dte : null));
                    }
                    map[kvp.Key] = pts;
                }
            }
            return new SkewHistory(map);
        }

        /// <summary>
        /// El punto de hace <paramref name="sessions"/> sesiones respecto de la sesión "actual"
        /// (que llega live, fuera de la serie). Con serie [t-5..t-1] y sessions=5 devuelve t-5.
        /// Null si no hay suficiente historia.
        /// </summary>
        public Point? PointSessionsAgo(string symbol, int sessions)
        {
            if (!_bySymbol.TryGetValue(symbol, out var pts) || pts.Count < sessions) return null;
            return pts[pts.Count - sessions];
        }

        /// <summary>Valor de hace <paramref name="sessions"/> sesiones. Null si falta historia.</summary>
        public double? ValueSessionsAgo(string symbol, int sessions) =>
            PointSessionsAgo(symbol, sessions)?.Skew25;

        /// <summary>
        /// RoC 5d = skew25_live / skew25(hace 5 sesiones) - 1. Null si falta historia o si los dos
        /// extremos no miden plazos comparables.
        /// </summary>
        /// <param name="currentDte">
        /// DTE de la cadena sobre la que se midió <paramref name="currentSkew25"/>. 0 = desconocido,
        /// y entonces no se aplica la guarda de plazo.
        /// </param>
        public double? Roc5d(string symbol, double currentSkew25, int currentDte = 0)
        {
            var past = PointSessionsAgo(symbol, 5);
            if (past is null || past.Skew25 <= 0 || currentSkew25 <= 0) return null;

            if (currentDte > 0)
            {
                if (past.Dte is null) return null;
                if (Math.Abs(past.Dte.Value - currentDte) > DteToleranceDays) return null;
            }

            return currentSkew25 / past.Skew25 - 1.0;
        }
    }
}
