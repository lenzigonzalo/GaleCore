using System.Text;

namespace DataFeed.Application.App.Shared
{
    /// <summary>
    /// El nombre con el que se entra a la plataforma.
    ///
    /// Función pura, como <see cref="StrategyEnablement"/>: no lee base ni archivos. Está acá y no
    /// en la capa Api para que el charset se pueda testear sin levantar nada — y porque la MISMA
    /// regla la aplican tres lugares que no pueden contradecirse: el check de Postgres, el alta
    /// desde Administrator y el username que se deriva del mail cuando un usuario aparece sin fila.
    ///
    /// EL USERNAME NO REEMPLAZA AL EMAIL. El mail sigue siendo real, único y requerido: es la
    /// identidad de Supabase Auth, la que recibe el reset de contraseña. El username es solo la
    /// llave con la que el login lo resuelve, y vive en una sola tabla — por eso cambiarlo no
    /// escribe en dos sistemas que se puedan desincronizar.
    ///
    /// El charset es deliberadamente angosto (<c>^[a-z0-9._-]{3,32}$</c>, siempre en minúscula):
    /// sin mayúsculas no hay dos usuarios que se vean iguales y no lo sean, y sin espacios ni
    /// acentos no hay forma de tipear mal el propio usuario y no darse cuenta.
    /// </summary>
    public static class Usernames
    {
        public const int MinLength = 3;
        public const int MaxLength = 32;

        /// <summary>
        /// El patrón que valida un username. Es el MISMO que el check de la base
        /// (`ck_users_username`): si acá se afloja y allá no, el alta explota con un 500 de
        /// constraint en vez de con un mensaje que se pueda leer.
        /// </summary>
        public const string Pattern = "^[a-z0-9._-]{3,32}$";

        /// <summary>
        /// ¿Es un username válido? Espera la forma ya normalizada — la mayúscula NO se perdona acá
        /// a propósito, para que quien valida un valor que ya está guardado detecte una escritura
        /// que se saltó <see cref="Normalize"/>.
        /// </summary>
        public static bool IsValid(string? username)
        {
            if (string.IsNullOrEmpty(username)) return false;
            if (username.Length < MinLength || username.Length > MaxLength) return false;

            foreach (var c in username)
            {
                var ok = (c >= 'a' && c <= 'z')
                      || (c >= '0' && c <= '9')
                      || c == '.' || c == '_' || c == '-';
                if (!ok) return false;
            }

            return true;
        }

        /// <summary>
        /// Lo que el usuario escribió, llevado a la forma canónica: sin espacios alrededor y en
        /// minúscula. NO arregla los caracteres inválidos — devuelve lo que quedó, para que
        /// <see cref="IsValid"/> lo rechace y el mensaje de error hable del texto real.
        /// </summary>
        public static string Normalize(string? input)
            => (input ?? string.Empty).Trim().ToLowerInvariant();

        /// <summary>
        /// Un username derivado del mail, para el usuario que aparece sin fila (lo crearon en el
        /// panel de Supabase, no desde Administrator). Toma la parte local, reemplaza lo que no
        /// entra en el charset por '-' y rellena si quedó corto.
        ///
        /// Puede chocar con uno existente: el índice único es el que decide, y quien llama resuelve
        /// el empate con <see cref="Deduplicate"/>. Acá no se consulta nada.
        /// </summary>
        public static string FromEmail(string? email)
        {
            var local = (email ?? string.Empty).Trim().ToLowerInvariant();
            // Se corta también cuando el '@' está al principio: un mail sin parte local no aporta
            // nada, y quedarse con el dominio daría un username que no se parece a nadie.
            var at = local.IndexOf('@');
            if (at >= 0) local = local.Substring(0, at);

            var sb = new StringBuilder(MaxLength);
            foreach (var c in local)
            {
                if (sb.Length >= MaxLength) break;

                if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-')
                    sb.Append(c);
                else
                    sb.Append('-');
            }

            // Sin nada usable (un mail de puros caracteres raros, o vacío) queda "user", que es
            // válido y editable. Devolver algo inválido sería mover el problema al INSERT.
            var candidate = sb.ToString();
            if (candidate.Length < MinLength) candidate = (candidate + "user").Substring(0, MinLength);

            return candidate;
        }

        /// <summary>
        /// Un username libre a partir de uno tomado: le cuelga -2, -3, … respetando el largo máximo.
        /// </summary>
        /// <param name="baseName">El candidato original, ya normalizado.</param>
        /// <param name="isTaken">Si ese nombre ya existe. Lo resuelve quien tenga la base a mano.</param>
        /// <param name="maxAttempts">
        /// Cota del intento: sin ella, una base inalcanzable que contesta "sí, existe" a todo
        /// dejaría el request girando para siempre. Al agotarse devuelve el último candidato y deja
        /// que el índice único sea el que corte.
        /// </param>
        public static string Deduplicate(string baseName, Func<string, bool> isTaken, int maxAttempts = 50)
        {
            if (!isTaken(baseName)) return baseName;

            for (var i = 2; i <= maxAttempts; i++)
            {
                var suffix = "-" + i;
                var trunk = baseName.Length + suffix.Length > MaxLength
                    ? baseName.Substring(0, MaxLength - suffix.Length)
                    : baseName;

                var candidate = trunk + suffix;
                if (!isTaken(candidate)) return candidate;
            }

            return baseName;
        }
    }
}
