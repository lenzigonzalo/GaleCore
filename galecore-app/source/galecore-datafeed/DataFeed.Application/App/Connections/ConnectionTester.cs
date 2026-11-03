using System.Text;
using System.Text.Json;

namespace DataFeed.Application.App.Connections
{
    public sealed record ConnectionTestResult(bool Ok, string Message, DateTime At);

    /// <summary>
    /// Llamada mínima real a FRED, BLS o SEC (WS-0080). El mensaje lo arma esta clase: nunca incluye la URL (FRED lleva la
    /// clave en la query) ni el valor, y como red de seguridad cualquier aparición del valor se reemplaza por «••••».
    /// </summary>
    public static class ConnectionTester
    {
        public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        public static async Task<ConnectionTestResult> RunAsync(string id, string? value, HttpClient http, CancellationToken ct)
        {
            string name = ConnectionCatalog.Find(id)?.Name ?? id;
            bool ok;
            string message;
            try
            {
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(Timeout);
                (ok, message) = id switch
                {
                    "fred" => await TestFredAsync(value, http, cts.Token),
                    "bls" => await TestBlsAsync(value, http, cts.Token),
                    "sec" => await TestSecAsync(value, http, cts.Token),
                    _ => (false, $"{name} no tiene una clave que probar."),
                };
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                (ok, message) = (false, $"{name}: sin respuesta en {(int)Timeout.TotalSeconds} s.");
            }
            catch (HttpRequestException)
            {
                // El texto de la excepción puede traer la URL: no se usa.
                (ok, message) = (false, $"{name}: no se pudo conectar.");
            }
            return new ConnectionTestResult(ok, Sanitize(message, value), DateTime.UtcNow);
        }

        /// <summary>Reemplaza el valor por «••••» y acota el largo.</summary>
        public static string Sanitize(string message, string? secret)
        {
            if (!string.IsNullOrEmpty(secret)) message = message.Replace(secret, "••••", StringComparison.OrdinalIgnoreCase);
            return message.Length > 300 ? message[..300] : message;
        }

        private static async Task<(bool, string)> TestFredAsync(string? key, HttpClient http, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(key)) return (false, "FRED: falta la clave.");
            using var response = await http.GetAsync(
                $"https://api.stlouisfed.org/fred/series?series_id=DGS10&api_key={Uri.EscapeDataString(key)}&file_type=json", ct);
            var code = (int)response.StatusCode;
            if (response.IsSuccessStatusCode) return (true, "FRED respondió bien.");
            return (false, code is 400 or 401 or 403 ? $"FRED respondió {code}: clave inválida." : $"FRED respondió {code}.");
        }

        private static async Task<(bool, string)> TestBlsAsync(string? key, HttpClient http, CancellationToken ct)
        {
            var year = DateTime.UtcNow.Year;
            var body = new Dictionary<string, object>
            {
                ["seriesid"] = new[] { "LNS14000000" },
                ["startyear"] = $"{year - 1}",
                ["endyear"] = $"{year - 1}",
            };
            if (!string.IsNullOrWhiteSpace(key)) body["registrationkey"] = key;
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.bls.gov/publicAPI/v2/timeseries/data/")
            {
                Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
            };
            using var response = await http.SendAsync(request, ct);
            var code = (int)response.StatusCode;
            if (!response.IsSuccessStatusCode) return (false, $"BLS respondió {code}.");

            // El BLS contesta 200 aunque rechace el pedido: hay que mirar el status del cuerpo.
            var json = await response.Content.ReadAsStringAsync(ct);
            try
            {
                using var doc = JsonDocument.Parse(json);
                var status = doc.RootElement.TryGetProperty("status", out var s) ? s.GetString() : null;
                if (status == "REQUEST_SUCCEEDED")
                    return (true, string.IsNullOrWhiteSpace(key) ? "BLS respondió bien (sin clave, con límites bajos)." : "BLS respondió bien.");
                var detail = doc.RootElement.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.Array
                    ? string.Join(" ", m.EnumerateArray().Select(x => x.GetString()))
                    : null;
                return (false, string.IsNullOrWhiteSpace(detail) ? "BLS rechazó el pedido." : $"BLS rechazó el pedido: {detail}");
            }
            catch (JsonException)
            {
                return (false, "BLS devolvió una respuesta ilegible.");
            }
        }

        private static async Task<(bool, string)> TestSecAsync(string? userAgent, HttpClient http, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(userAgent)) return (false, "SEC: falta el contacto (User-Agent).");
            using var request = new HttpRequestMessage(HttpMethod.Get, "https://data.sec.gov/submissions/CIK0000320193.json");
            request.Headers.TryAddWithoutValidation("User-Agent", userAgent);
            using var response = await http.SendAsync(request, ct);
            var code = (int)response.StatusCode;
            if (response.IsSuccessStatusCode) return (true, "SEC respondió bien.");
            return (false, code is 403 or 429 ? $"SEC respondió {code}: rechazó el contacto o hay demasiados pedidos." : $"SEC respondió {code}.");
        }
    }
}
