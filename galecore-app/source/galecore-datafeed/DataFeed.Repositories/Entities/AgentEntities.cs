namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Clave de agentes de un usuario (WS-0079): identifica al dueño cuando una rutina reporta una corrida. Una por
    /// usuario. Sólo se guarda el SHA-256 y los últimos 4 caracteres: la clave en claro se muestra una vez al generarla.
    /// </summary>
    public class AgentKey
    {
        public Guid OwnerId { get; set; }
        public User Owner { get; set; } = null!;
        /// <summary>SHA-256 de la clave, en hexadecimal minúscula (64 caracteres).</summary>
        public string KeyHash { get; set; } = "";
        public string KeyHint { get; set; } = "";
        public DateTime CreatedAt { get; set; }
    }

    /// <summary>
    /// Token de disparo de la rutina de un agente (WS-0079): trigger_id y token cifrado (AES-GCM, el mismo
    /// <c>ITokenProtector</c> de las credenciales). Único por dueño + agente. El token nunca sale de la API.
    /// </summary>
    public class AgentFireToken
    {
        public Guid OwnerId { get; set; }
        public User Owner { get; set; } = null!;
        /// <summary>Clave del ítem <c>agent</c> del espacio del trader.</summary>
        public string AgentKey { get; set; } = "";
        public string TriggerId { get; set; } = "";
        public string TokenCipher { get; set; } = "";
        public string TokenHint { get; set; } = "";
        public DateTime UpdatedAt { get; set; }
        /// <summary>Último disparo exitoso desde la API (límite de un disparo cada 5 minutos).</summary>
        public DateTime? LastFiredAt { get; set; }
    }

    /// <summary>
    /// Una corrida de un agente (WS-0079). Tabla aparte del ítem <c>agent</c> (que reescribe el Lab). Se conservan
    /// las últimas <see cref="MaxPerAgent"/> por (dueño, agente).
    /// </summary>
    public class AgentRun
    {
        public const int MaxPerAgent = 50;
        public const int MaxSummaryLength = 4000;
        public const int MaxResultLength = 50000;
        public static readonly string[] Origins = { "schedule", "manual" };
        public static readonly string[] Statuses = { "requested", "ok", "error", "skipped" };

        public Guid Id { get; set; }
        public Guid OwnerId { get; set; }
        public User Owner { get; set; } = null!;
        public string AgentKey { get; set; } = "";
        public string Origin { get; set; } = "schedule";
        public string Status { get; set; } = "requested";
        public string? Summary { get; set; }
        /// <summary>Cálculo de la skill de la corrida (JSON, WS-0099); se recorta junto con la corrida.</summary>
        public string? ResultJson { get; set; }
        public string? ReasonCode { get; set; }
        public string? TriggerId { get; set; }
        public string? SessionUrl { get; set; }
        public string? SessionId { get; set; }
        public DateTime? RequestedAt { get; set; }
        public DateTime? FiredAt { get; set; }
        public DateTime? FinishedAt { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    /// <summary>
    /// Aviso que una corrida dejó (WS-0099): sale una sola vez por (dueño, agente, <see cref="AlertId"/>). Sin FK a la
    /// corrida: sobrevive al recorte de corridas y se conserva <see cref="KeepDays"/> días.
    /// </summary>
    public class AgentAlert
    {
        public const int KeepDays = 30;
        public const int MaxPerReport = 10;
        public const int MaxIdLength = 100;
        public const int MaxTitleLength = 200;

        public Guid Id { get; set; }
        public Guid OwnerId { get; set; }
        public User Owner { get; set; } = null!;
        public string AgentKey { get; set; } = "";
        public string AlertId { get; set; } = "";
        public string Title { get; set; } = "";
        public Guid RunId { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}
