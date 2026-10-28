using System.Text.Json.Nodes;

namespace DataFeed.Application.App.SignalGates
{
    /// <summary>
    /// Tabla POP empírica calibrada del research (BT-10), portada a Files/pop_calibration.json.
    /// Por símbolo, una lista de buckets de puts {delta, pLoss} donde pLoss = probabilidad empírica
    /// de terminar ITM (= probabilidad de pérdida del PCS). Se interpola linealmente por |delta|.
    ///
    /// El gate `edge` usa: edge = (credit / width) / pLoss(|delta|). pLoss &lt; delta para puts (drift
    /// alcista + skew) es exactamente el edge que valida la venta de prima.
    /// </summary>
    public sealed class PopCalibrationTable
    {
        private readonly Dictionary<string, List<(double delta, double pLoss)>> _bySymbol;

        private PopCalibrationTable(Dictionary<string, List<(double, double)>> bySymbol)
            => _bySymbol = bySymbol;

        /// <summary>Parsea el JSON de calibración (Files/pop_calibration.json).</summary>
        public static PopCalibrationTable Parse(string json)
        {
            var map = new Dictionary<string, List<(double, double)>>(StringComparer.OrdinalIgnoreCase);
            var root = JsonNode.Parse(json)?.AsObject();
            var symbols = root?["symbols"]?.AsObject();
            if (symbols != null)
            {
                foreach (var kvp in symbols)
                {
                    var rows = kvp.Value?.AsArray();
                    if (rows == null) continue;

                    var list = new List<(double, double)>();
                    foreach (var r in rows)
                    {
                        double? d = r?["delta"]?.GetValue<double>();
                        double? p = r?["pLoss"]?.GetValue<double>();
                        if (d.HasValue && p.HasValue) list.Add((Math.Abs(d.Value), p.Value));
                    }
                    list.Sort((a, b) => a.Item1.CompareTo(b.Item1));
                    map[kvp.Key] = list;
                }
            }
            return new PopCalibrationTable(map);
        }

        /// <summary>
        /// Probabilidad de pérdida (ITM empírico) interpolada linealmente para un |delta| dado.
        /// Fuera de rango, clampea al bucket extremo. Devuelve null si no hay tabla para el símbolo.
        /// </summary>
        public double? PLoss(string symbol, double absDelta)
        {
            if (!_bySymbol.TryGetValue(symbol, out var pts) || pts.Count == 0) return null;
            absDelta = Math.Abs(absDelta);

            if (absDelta <= pts[0].delta) return pts[0].pLoss;
            if (absDelta >= pts[^1].delta) return pts[^1].pLoss;

            for (int i = 1; i < pts.Count; i++)
            {
                if (absDelta <= pts[i].delta)
                {
                    var (d0, p0) = pts[i - 1];
                    var (d1, p1) = pts[i];
                    double t = (absDelta - d0) / (d1 - d0);
                    return p0 + t * (p1 - p0);
                }
            }
            return pts[^1].pLoss;
        }
    }
}
