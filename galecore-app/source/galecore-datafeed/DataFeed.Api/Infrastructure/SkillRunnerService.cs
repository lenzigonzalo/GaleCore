using System.Diagnostics;
using System.Text.RegularExpressions;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Corre scripts de skills Python en el VPS para las rutinas cloud (WS-0093): el cálculo se hace acá (con
    /// knowledge/ del usuario), la narrativa la escribe el modelo en la nube. Solo skills de la whitelist,
    /// con concurrencia acotada y timeout. En desarrollo no existe Python y el endpoint contesta 503.
    /// </summary>
    public sealed partial class SkillRunnerService
    {
        public sealed class Options
        {
            public string PythonPath { get; set; } = "/srv/galecore/ai/venv/bin/python";
            public string WorkingDirectory { get; set; } = "/srv/galecore/ai/galecore-ai";
            public string BaseUrl { get; set; } = "http://127.0.0.1:5001";
            public string[] AllowedSkills { get; set; } = Array.Empty<string>();
            public int TimeoutSeconds { get; set; } = 180;
            public int MaxConcurrent { get; set; } = 1;
        }

        public sealed record RunResult(bool Ok, int? ExitCode, string? Json, string? Error);

        private readonly Options _opts;
        private readonly string _apiKey;
        private readonly SemaphoreSlim _gate;
        private readonly ILogger<SkillRunnerService> _log;

        public SkillRunnerService(Options opts, string apiKey, ILogger<SkillRunnerService> log)
        {
            _opts = opts;
            _apiKey = apiKey;
            _gate = new SemaphoreSlim(opts.MaxConcurrent, opts.MaxConcurrent);
            _log = log;
        }

        /// <summary>El Python del VPS existe: en desarrollo no, y el endpoint da 503.</summary>
        public bool IsAvailable => File.Exists(_opts.PythonPath);

        public async Task<RunResult> RunAsync(string username, string skillKey, string script, string[] args,
            string agentKey, CancellationToken ct)
        {
            if (!_opts.AllowedSkills.Contains(skillKey))
                return new(false, null, null, $"Skill '{skillKey}' no está habilitada para ejecución remota.");
            if (!ValidScript(script))
                return new(false, null, null, "Script inválido: solo nombres .py sin ruta.");
            foreach (var a in args)
                if (a.Length > 1000)
                    return new(false, null, null, "Un argumento excede 1000 caracteres.");

            if (!await _gate.WaitAsync(TimeSpan.FromSeconds(30), ct))
                return new(false, null, null, "Demasiadas corridas concurrentes; reintentá en un minuto.");

            try { return await ExecuteAsync(username, skillKey, script, args, agentKey, ct); }
            finally { _gate.Release(); }
        }

        private static bool ValidScript(string script) =>
            !string.IsNullOrEmpty(script) && script.EndsWith(".py") && script == Path.GetFileName(script)
            && !script.Contains("..") && ScriptNameRegex().IsMatch(script);

        [GeneratedRegex(@"^[a-z0-9_]+\.py$")]
        private static partial Regex ScriptNameRegex();

        private async Task<RunResult> ExecuteAsync(string username, string skill, string script, string[] args,
            string agentKey, CancellationToken ct)
        {
            var psi = new ProcessStartInfo(_opts.PythonPath)
            {
                WorkingDirectory = _opts.WorkingDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("-B");
            psi.ArgumentList.Add("-m");
            psi.ArgumentList.Add("galecore_ai.adapters.cli");
            psi.ArgumentList.Add("skill");
            psi.ArgumentList.Add("run");
            psi.ArgumentList.Add("--timeout");
            psi.ArgumentList.Add(_opts.TimeoutSeconds.ToString());
            psi.ArgumentList.Add(skill);
            psi.ArgumentList.Add(script);
            foreach (var a in args) psi.ArgumentList.Add(a);

            psi.Environment["GALECORE_BASE_URL"] = _opts.BaseUrl;
            psi.Environment["GALECORE_API_KEY"] = _apiKey;
            psi.Environment["GALECORE_AGENT_KEY"] = agentKey;
            psi.Environment["GALECORE_KNOWLEDGE_DIR"] = $"/home/{username}/GaleCore-datos/knowledge";
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            // No GALECORE_RESULTS_DIR ni GALECORE_SKILL_RUN_REMOTE: corre local, el caller recibe el JSON.

            using var process = new Process { StartInfo = psi };
            try
            {
                if (!process.Start())
                    return new(false, null, null, "No se pudo iniciar el proceso Python.");
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Skill {Skill}/{Script}: no se pudo lanzar Python", skill, script);
                return new(false, null, null, "No se pudo iniciar el proceso Python.");
            }

            var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
            var stderrTask = process.StandardError.ReadToEndAsync(ct);

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(_opts.TimeoutSeconds + 15));

            try
            {
                await process.WaitForExitAsync(cts.Token);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                try { process.Kill(entireProcessTree: true); } catch { /* best effort */ }
                _log.LogWarning("Skill {Skill}/{Script} para {User}: timeout", skill, script, username);
                return new(false, null, null, $"Timeout después de {_opts.TimeoutSeconds}s.");
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;

            _log.LogInformation("Skill {Skill}/{Script} para {User}: exit={ExitCode}, stdout={Len}B",
                skill, script, username, process.ExitCode, stdout.Length);

            if (string.IsNullOrWhiteSpace(stdout))
            {
                var trimmed = stderr.Length > 500 ? stderr[^500..] : stderr;
                return new(false, process.ExitCode, null, $"Sin salida (exit {process.ExitCode}): {trimmed.Trim()}");
            }

            return new(process.ExitCode == 0, process.ExitCode, stdout.Trim(), null);
        }
    }
}
