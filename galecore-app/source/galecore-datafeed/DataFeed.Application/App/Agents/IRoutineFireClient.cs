using System.Net;
using System.Text;
using System.Text.Json;

namespace DataFeed.Application.App.Agents
{
    public enum FireOutcome { Ok, Unauthorized, Paused, Failed }

    /// <summary>Resultado de disparar una rutina. <see cref="Error"/> es corto y nunca lleva el token.</summary>
    public sealed record FireResult(FireOutcome Outcome, string? SessionId = null, string? SessionUrl = null, string? Error = null);

    /// <summary>Dispara una rutina de Claude Code (WS-0079); existe para probar el servicio sin red.</summary>
    public interface IRoutineFireClient
    {
        Task<FireResult> FireAsync(string triggerId, string token, string? text, CancellationToken ct);
    }

    public sealed class AnthropicRoutineFireClient : IRoutineFireClient
    {
        public const string BaseUrl = "https://api.anthropic.com/v1/claude_code/routines/";
        private readonly IHttpClientFactory _http;

        public AnthropicRoutineFireClient(IHttpClientFactory http) => _http = http;

        public async Task<FireResult> FireAsync(string triggerId, string token, string? text, CancellationToken ct)
        {
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, BaseUrl + Uri.EscapeDataString(triggerId) + "/fire");
                req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + token);
                req.Headers.TryAddWithoutValidation("anthropic-beta", "experimental-cc-routine-2026-04-01");
                req.Headers.TryAddWithoutValidation("anthropic-version", "2023-06-01");
                var body = string.IsNullOrWhiteSpace(text) ? "{}" : JsonSerializer.Serialize(new { text });
                req.Content = new StringContent(body, Encoding.UTF8, "application/json");

                using var client = _http.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(30);
                using var res = await client.SendAsync(req, ct);
                if (res.StatusCode == HttpStatusCode.Unauthorized) return new FireResult(FireOutcome.Unauthorized);
                if (res.StatusCode == HttpStatusCode.BadRequest && IsPaused(await res.Content.ReadAsStringAsync(ct)))
                    return new FireResult(FireOutcome.Paused);
                if (!res.IsSuccessStatusCode) return new FireResult(FireOutcome.Failed, Error: $"Anthropic respondió {(int)res.StatusCode}");

                var (id, url) = ParseSession(await res.Content.ReadAsStringAsync(ct));
                return new FireResult(FireOutcome.Ok, id, url);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                return new FireResult(FireOutcome.Failed, Error: "Anthropic no respondió a tiempo");
            }
            catch (HttpRequestException)
            {
                return new FireResult(FireOutcome.Failed, Error: "no se pudo conectar con Anthropic");
            }
        }

        /// <summary>400 con error.reason == "routine_paused".</summary>
        public static bool IsPaused(string body)
        {
            try
            {
                using var doc = JsonDocument.Parse(body);
                return doc.RootElement.ValueKind == JsonValueKind.Object
                    && doc.RootElement.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.Object
                    && e.TryGetProperty("reason", out var r) && r.ValueKind == JsonValueKind.String && r.GetString() == "routine_paused";
            }
            catch (JsonException) { return false; }
        }

        /// <summary>Lee claude_code_session_id/url (respuesta real de /fire); respaldo: session_id/id y session_url/url, y sigue si el cuerpo no es JSON.</summary>
        public static (string? Id, string? Url) ParseSession(string body)
        {
            try
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.ValueKind != JsonValueKind.Object) return (null, null);
                string? Pick(params string[] names)
                {
                    foreach (var n in names)
                        if (doc.RootElement.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString()))
                            return v.GetString();
                    return null;
                }
                return (Pick("claude_code_session_id", "session_id", "id"), Pick("claude_code_session_url", "session_url", "url", "link"));
            }
            catch (JsonException) { return (null, null); }
        }
    }
}
