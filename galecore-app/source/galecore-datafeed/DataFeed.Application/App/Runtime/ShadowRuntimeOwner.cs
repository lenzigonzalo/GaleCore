namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// De quién es el runtime SHADOW de ESTA API (`Runtime:OwnerUserId`). Dos personas pueden correr cada una su
    /// propia API contra la misma base: con el dueño fijado, esta API sólo recupera, evalúa, monitorea y muestra las
    /// instancias cuyo deployment hizo ese usuario (`DeployedBy`), y sólo ese usuario puede desplegar o parar.
    /// Sin dueño (producción, un solo ejecutor para todos los usuarios) las lecturas no se filtran (todos ven todas),
    /// pero desplegar y parar exigen usuario autenticado: la instancia queda a nombre de quien la desplegó y sólo
    /// ella o un admin la puede parar.
    /// </summary>
    public sealed class ShadowRuntimeOwner
    {
        public const string ConfigKey = "Runtime:OwnerUserId";

        public ShadowRuntimeOwner(Guid? userId) => UserId = userId == Guid.Empty ? null : userId;

        public Guid? UserId { get; }
        public bool IsScoped => UserId != null;

        /// <summary>Lo que se guarda en StrategyDeployment.DeployedBy para ese usuario.</summary>
        public static string DeployedByOf(Guid? userId) => userId?.ToString() ?? "SYSTEM";

        /// <summary>
        /// ¿Puede este usuario desplegar o parar en esta API? Sin usuario autenticado (sólo la ApiKey local: el operador
        /// de esta API, p. ej. el Lab) se permite; con usuario, tiene que ser el dueño.
        /// </summary>
        public bool Allows(Guid? userId) => UserId == null || userId == null || userId == UserId;

        /// <summary>A quién se le atribuye el deploy/stop: con dueño y sin usuario autenticado, al dueño.</summary>
        public Guid? Attribute(Guid? userId) => userId ?? UserId;

        /// <summary>Respuesta de rechazo (HTTP) que el controller sólo aplica.</summary>
        public sealed record Denial(int Status, string Error);

        public const string NoUserMessage =
            "En este GaleCore se despliega con tu sesión de usuario: sin ella la estrategia quedaría sin dueño. No se desplegó nada.";

        public const string NoUserStopMessage =
            "En este GaleCore se para con tu sesión de usuario: sin ella no se sabe de quién es la estrategia. No se paró nada.";

        public const string NotYoursMessage =
            "Esta estrategia SHADOW es de otro usuario: sólo quien la desplegó o un admin la puede parar.";

        /// <summary>
        /// ¿Se puede desplegar? Con dueño: como siempre (<see cref="Allows"/>, 403). Sin dueño: hace falta usuario
        /// autenticado (401), para que la instancia quede a su nombre.
        /// </summary>
        public Denial? CheckDeploy(Guid? userId)
        {
            if (IsScoped) return Allows(userId) ? null : new Denial(403, DeniedMessage);
            return userId == null ? new Denial(401, NoUserMessage) : null;
        }

        /// <summary>
        /// ¿Se puede parar? Con dueño: como siempre (<see cref="Allows"/>, 403). Sin dueño: hace falta usuario (401);
        /// puede quien desplegó la instancia o un admin, el resto 403. <paramref name="deployedBy"/> null = la instancia
        /// no existe: no se rechaza acá, el controller responde 404.
        /// </summary>
        public Denial? CheckStop(Guid? userId, string? deployedBy, bool isAdmin)
        {
            if (IsScoped) return Allows(userId) ? null : new Denial(403, DeniedMessage);
            if (userId == null) return new Denial(401, NoUserStopMessage);
            if (deployedBy == null || isAdmin || deployedBy == userId.Value.ToString()) return null;
            return new Denial(403, NotYoursMessage);
        }

        public const string DeniedMessage =
            "Este GaleCore corre las estrategias SHADOW de otro usuario: con tu cuenta no podés desplegar ni parar acá.";
    }
}
