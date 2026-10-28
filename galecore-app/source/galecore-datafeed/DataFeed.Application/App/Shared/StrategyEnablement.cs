namespace DataFeed.Application.App.Shared
{
    /// <summary>
    /// Resolución del switch ON/OFF de una estrategia, que tiene DOS niveles.
    ///
    /// Función pura y compartida por las dos estrategias, como los primitivos de
    /// <see cref="CascadeUtils"/>: no lee archivos ni base — recibe los dos valores ya leídos.
    /// Está acá y no en la capa Api para que la tabla de verdad se pueda testear sin levantar nada.
    ///
    ///   | Nivel      | Dónde vive                                   | Ausente significa     |
    ///   |------------|----------------------------------------------|-----------------------|
    ///   | reglas     | galecore_rules_&lt;prefijo&gt;.json (git)          | — (es el piso)        |
    ///   | plataforma | Files/&lt;Prefijo&gt;/&lt;prefijo&gt;_switch_state.json    | manda reglas          |
    ///
    /// EL SWITCH ES GLOBAL: apagar una estrategia la apaga para todos. Es el kill switch del
    /// operador —corta el consumo de feed y la emisión— y por eso el POST que lo escribe está
    /// restringido a los admin de la plataforma (`users.is_admin`): un segundo operador no puede
    /// apagarle la estrategia al resto.
    ///
    /// El nivel de plataforma vive en un ARCHIVO y no en la base a propósito: persiste a disco
    /// (un kill switch que vuelve solo a ON tras un restart es un agujero) y se lee sin red, así
    /// que una base caída no puede volver a prender lo que se apagó deliberadamente.
    /// Ver docs/GaleCore-arquitectura-datos.md §5.
    ///
    /// HUBO UN TERCER NIVEL —la preferencia por usuario en la tabla `user_strategies`— entre el
    /// 2026-08-12 y el 2026-08-12. Se eliminó junto con el catálogo de estrategias en la base:
    /// con dos operadores, poder silenciar una estrategia en el tablero propio no justificaba que
    /// el loop de RPF consultara la base en cada tick para preguntar si le servía a alguien.
    /// Ver docs/GaleCore-plan-reorganizacion-2026-08.md, etapa 1.
    /// </summary>
    public static class StrategyEnablement
    {
        /// <summary>Manda el JSON de reglas: nadie tocó el switch.</summary>
        public const string SourceRules = "rules";

        /// <summary>Manda el archivo de estado de la estrategia (kill switch del operador).</summary>
        public const string SourcePlatform = "platform";

        /// <summary>
        /// Estado efectivo de la estrategia, y qué nivel lo decidió.
        /// </summary>
        /// <param name="rules">Lo que declara el JSON de reglas de la estrategia.</param>
        /// <param name="platform">Override de plataforma, o null si nunca se tocó.</param>
        public static (bool Enabled, string Source) Resolve(bool rules, bool? platform)
            => platform.HasValue
                ? (platform.Value, SourcePlatform)
                : (rules, SourceRules);
    }
}
