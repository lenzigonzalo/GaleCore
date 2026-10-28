namespace DataFeed.Application.App.Runtime
{
    /// <summary>
    /// De quién es el runtime SHADOW de ESTA API (`Runtime:OwnerUserId`). Dos personas pueden correr cada una su
    /// propia API contra la misma base: con el dueño fijado, esta API sólo recupera, evalúa, monitorea y muestra las
    /// instancias cuyo deployment hizo ese usuario (`DeployedBy`), y sólo ese usuario puede desplegar o parar.
    /// Sin dueño (producción, una sola API) no se filtra nada: se comporta como siempre.
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

        public const string DeniedMessage =
            "Este GaleCore corre las estrategias SHADOW de otro usuario: con tu cuenta no podés desplegar ni parar acá.";
        public const string SameVersionElsewhereMessage =
            "Otra cuenta ya corre esta misma versión de la estrategia en la base compartida: no se desplegó nada. Cambiá la estrategia para tener tu propia versión.";
    }
}
