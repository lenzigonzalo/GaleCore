namespace DataFeed.Application.App.Connections
{
    public enum ConnectionKind { Source, Broker, Mcp }
    public enum ConnectionOwner { Platform, Personal }
    public enum KeyNeed { Required, Optional, None }

    /// <summary>Una conexión del catálogo (WS-0080). <c>Group</c> agrupa en la pantalla ("Estados Unidos" | "Argentina" | null). <c>ConfigKey</c> sólo existe en las de plataforma con valor editable.</summary>
    public sealed record ConnectionDefinition(
        string Id, string Name, ConnectionKind Kind, ConnectionOwner Owner, KeyNeed Needs,
        string? KeyLabel, string? ConfigKey, string Description, string? Group = null);

    /// <summary>
    /// Catálogo estático de lo conectable (WS-0080). Las internas de la plataforma (ApiKey, Supabase:*, claves de cifrado
    /// y firma) NO están y no se editan desde la pantalla.
    /// </summary>
    public static class ConnectionCatalog
    {
        public static readonly IReadOnlyList<ConnectionDefinition> All = new[]
        {
            new ConnectionDefinition("fred", "FRED", ConnectionKind.Source, ConnectionOwner.Platform, KeyNeed.Required,
                "API key", "FredApi:Key", "Series macro de la Reserva Federal de St. Louis. Necesita API key gratuita.", "Estados Unidos"),
            new ConnectionDefinition("bls", "BLS", ConnectionKind.Source, ConnectionOwner.Platform, KeyNeed.Optional,
                "API key", "Bls:Key", "Empleo e inflación de EE.UU. Anda sin clave con límites bajos; con clave gratuita se amplían.", "Estados Unidos"),
            new ConnectionDefinition("sec", "SEC EDGAR", ConnectionKind.Source, ConnectionOwner.Platform, KeyNeed.Required,
                "Contacto (User-Agent)", "SecEdgar:UserAgent", "Presentaciones de la SEC. No tiene clave: exige un contacto (nombre y correo) en el User-Agent.", "Estados Unidos"),
            new ConnectionDefinition("tastytrade", "Tastytrade", ConnectionKind.Broker, ConnectionOwner.Personal, KeyNeed.Required,
                null, null, "Bróker y datos de mercado. Cada usuario vincula su cuenta en Configuración › Cuenta de bróker."),
            new ConnectionDefinition("cboe", "Cboe", ConnectionKind.Source, ConnectionOwner.Platform, KeyNeed.None,
                null, null, "Índices y volatilidad. No necesita clave.", "Estados Unidos"),
            new ConnectionDefinition("fed", "Reserva Federal", ConnectionKind.Source, ConnectionOwner.Platform, KeyNeed.None,
                null, null, "Calendario y datos de la Fed. No necesita clave.", "Estados Unidos"),
            new ConnectionDefinition("treasury", "Tesoro de EE.UU.", ConnectionKind.Source, ConnectionOwner.Platform, KeyNeed.None,
                null, null, "Tasas y subastas del Tesoro. No necesita clave.", "Estados Unidos"),
            new ConnectionDefinition("bcra", "BCRA", ConnectionKind.Source, ConnectionOwner.Platform, KeyNeed.None,
                null, null, "Tipos de cambio y variables monetarias del Banco Central. No necesita clave.", "Argentina"),
            new ConnectionDefinition("byma", "BYMA", ConnectionKind.Source, ConnectionOwner.Platform, KeyNeed.None,
                null, null, "Cotizaciones de la bolsa argentina. No necesita clave.", "Argentina"),
            new ConnectionDefinition("a3", "A3 Mercados", ConnectionKind.Source, ConnectionOwner.Platform, KeyNeed.Required,
                "API key", "A3:ApiKey", "A3 Mercados (ex MAE): renta fija y cambios. Necesita API key.", "Argentina"),
            new ConnectionDefinition("datosgob", "datos.gob.ar", ConnectionKind.Source, ConnectionOwner.Platform, KeyNeed.None,
                null, null, "Series de tiempo del Estado argentino. No necesita clave.", "Argentina"),
            new ConnectionDefinition("dolarapi", "DolarAPI", ConnectionKind.Source, ConnectionOwner.Platform, KeyNeed.None,
                null, null, "Cotizaciones del dólar en Argentina. No necesita clave.", "Argentina"),
            new ConnectionDefinition("argentinadatos", "ArgentinaDatos", ConnectionKind.Source, ConnectionOwner.Platform, KeyNeed.None,
                null, null, "Indicadores económicos de Argentina. No necesita clave.", "Argentina"),
            new ConnectionDefinition("alphavantage", "Alpha Vantage", ConnectionKind.Mcp, ConnectionOwner.Personal, KeyNeed.Required,
                null, null, "Conector MCP del motor, en la PC de cada usuario."),
            new ConnectionDefinition("fmp", "FMP", ConnectionKind.Mcp, ConnectionOwner.Personal, KeyNeed.Required,
                null, null, "Conector MCP del motor, en la PC de cada usuario."),
            new ConnectionDefinition("ibkr", "IBKR", ConnectionKind.Mcp, ConnectionOwner.Personal, KeyNeed.Required,
                null, null, "Conector MCP del motor, en la PC de cada usuario."),
            new ConnectionDefinition("iol", "IoL", ConnectionKind.Mcp, ConnectionOwner.Personal, KeyNeed.Required,
                null, null, "Conector MCP del motor, en la PC de cada usuario."),
        };

        public static ConnectionDefinition? Find(string id) =>
            All.FirstOrDefault(c => string.Equals(c.Id, id, StringComparison.OrdinalIgnoreCase));

        /// <summary>Las que se pueden cargar desde la plataforma (fred, bls, sec, a3).</summary>
        public static bool IsEditable(ConnectionDefinition c) => c.ConfigKey != null;
    }
}
