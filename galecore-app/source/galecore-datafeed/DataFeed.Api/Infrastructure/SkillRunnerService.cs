using System.Diagnostics;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Corre comandos del CLI de galecore-ai en el VPS para las rutinas cloud (WS-0093): el cálculo se hace acá (con
    /// knowledge/ del usuario), la narrativa la escribe el modelo en la nube. Solo comandos de la whitelist,
    /// con concurrencia acotada y timeout. En desarrollo no existe Python y el endpoint contesta 503.
    /// </summary>
    public sealed class SkillRunnerService
    {
        public sealed class Options
        {
            public string PythonPath { get; set; } = "/srv/galecore/ai/venv/bin/python";
            public string WorkingDirectory { get; set; } = "/srv/galecore/ai/galecore-ai";
            public string BaseUrl { get; set; } = "http://127.0.0.1:5001";
            /// <summary>Comandos del CLI permitidos (primer argumento): story, kb, research, skill.</summary>
            public string[] AllowedCommands { get; set; } = Array.Empty<string>();
            public int TimeoutSeconds { get; set; } = 180;
            public int MaxConcurrent { get; set; } = 1;
        }

        public sealed record RunResult(bool Ok, int? ExitCode, string? Stdout, string? Stderr, string? Error);

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

        /// <summary>Corre un comando del CLI de galecore-ai como subprocess, con knowledge/ del usuario.</summary>
        public async Task<RunResult> RunCliAsync(string username, string[] cliArgs, string agentKey, CancellationToken ct)
        {
            if (cliArgs.Length == 0)
                return new(false, null, null, null, "Faltan argumentos.");
            if (!_opts.AllowedCommands.Contains(cliArgs[0]))
                return new(false, null, null, null, $"Comando '{cliArgs[0]}' no permitido. Permitidos: {string.Join(", ", _opts.AllowedCommands)}");
            foreach (var a in cliArgs)
                if (a.Length > 2000)
                    return new(false, null, null, null, "Un argumento excede 2000 caracteres.");

            if (!await _gate.WaitAsync(TimeSpan.FromSeconds(30), ct))
                return new(false, null, null, null, "Demasiadas corridas concurrentes; reintentá en un minuto.");

            try { return await ExecuteAsync(username, cliArgs, agentKey, ct); }
            finally { _gate.Release(); }
        }

        private async Task<RunResult> ExecuteAsync(string username, string[] cliArgs, string agentKey, CancellationToken ct)
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
            foreach (var a in cliArgs) psi.ArgumentList.Add(a);

            psi.Environment["GALECORE_BASE_URL"] = _opts.BaseUrl;
            psi.Environment["GALECORE_API_KEY"] = _apiKey;
            psi.Environment["GALECORE_AGENT_KEY"] = agentKey;
            psi.Environment["GALECORE_KNOWLEDGE_DIR"] = $"/home/{username}/GaleCore-datos/knowledge";
            psi.Environment["PYTHONIOENCODING"] = "utf-8";

            var label = string.Join(" ", cliArgs.Take(2));
            using var process = new Process { StartInfo = psi };
            try
            {
                if (!process.Start())
                    return new(false, null, null, null, "No se pudo iniciar el proceso Python.");
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "CLI {Cmd} para {User}: no se pudo lanzar Python", label, username);
                return new(false, null, null, null, "No se pudo iniciar el proceso Python.");
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
                _log.LogWarning("CLI {Cmd} para {User}: timeout", label, username);
                return new(false, null, null, null, $"Timeout después de {_opts.TimeoutSeconds}s.");
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;

            _log.LogInformation("CLI {Cmd} para {User}: exit={ExitCode}, stdout={Len}B",
                label, username, process.ExitCode, stdout.Length);

            return new(process.ExitCode == 0, process.ExitCode, stdout, stderr, null);
        }
    }
}
