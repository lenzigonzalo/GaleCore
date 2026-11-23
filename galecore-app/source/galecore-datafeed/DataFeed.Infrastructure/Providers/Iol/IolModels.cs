using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DataFeed.Infrastructure.Providers.Iol
{
    /// <summary>Usuario y contraseña de IOL (descifrados sólo en memoria, nunca se loguean).</summary>
    public sealed record IolCredentials(string Username, string Password);

    /// <summary>Sobre común de la API de IOL: <c>{ meta, data, error }</c>.</summary>
    internal sealed class IolEnvelope<T>
    {
        [JsonPropertyName("meta")] public IolMeta? Meta { get; set; }
        [JsonPropertyName("data")] public T? Data { get; set; }
        [JsonPropertyName("error")] public IolError? Error { get; set; }
    }

    internal sealed class IolMeta
    {
        [JsonPropertyName("trace_id")] public string? TraceId { get; set; }
    }

    internal sealed class IolError
    {
        [JsonPropertyName("message")] public string? Message { get; set; }
        [JsonPropertyName("code")] public string? Code { get; set; }
    }

    /// <summary><c>data</c> de <c>POST /auth/token</c>. Sólo lo que se usa.</summary>
    internal sealed class IolTokenData
    {
        [JsonPropertyName("access_token")] public string? AccessToken { get; set; }
        [JsonPropertyName("refresh_token")] public string? RefreshToken { get; set; }
        [JsonPropertyName("expires_in"), JsonConverter(typeof(FlexibleDoubleConverter))] public double? ExpiresIn { get; set; }
    }

    /// <summary>Acepta número o texto numérico (tolerante a cambios del proveedor).</summary>
    internal sealed class FlexibleDoubleConverter : JsonConverter<double?>
    {
        public override double? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.Number) return reader.GetDouble();
            if (reader.TokenType == JsonTokenType.String &&
                double.TryParse(reader.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d))
                return d;
            reader.Skip();
            return null;
        }

        public override void Write(Utf8JsonWriter writer, double? value, JsonSerializerOptions options)
        {
            if (value.HasValue) writer.WriteNumberValue(value.Value); else writer.WriteNullValue();
        }
    }

    /// <summary>Plazos de liquidación de un saldo (t0 = hoy).</summary>
    public sealed class IolTerms
    {
        [JsonPropertyName("t0")] public decimal? T0 { get; set; }
        [JsonPropertyName("t1")] public decimal? T1 { get; set; }
        [JsonPropertyName("t2")] public decimal? T2 { get; set; }
        [JsonPropertyName("t3")] public decimal? T3 { get; set; }
    }

    /// <summary>Saldo de una moneda de <c>GET /broker/accounts/{country}/balances</c>.</summary>
    public sealed class IolCurrencyBalance
    {
        [JsonPropertyName("currency")] public string? Currency { get; set; }
        [JsonPropertyName("totals")] public IolTerms? Totals { get; set; }
        [JsonPropertyName("available")] public IolTerms? Available { get; set; }
        [JsonPropertyName("committed")] public IolTerms? Committed { get; set; }
        [JsonPropertyName("available_for_withdrawal")] public decimal? AvailableForWithdrawal { get; set; }
    }

    /// <summary>Saldos de un país: AR trae <c>ars</c> y <c>usd</c>; US sólo <c>usd</c>.</summary>
    public sealed class IolBalances
    {
        [JsonPropertyName("ars")] public IolCurrencyBalance? Ars { get; set; }
        [JsonPropertyName("usd")] public IolCurrencyBalance? Usd { get; set; }
    }

    /// <summary><c>data</c> de <c>GET /broker/accounts/{country}/positions</c>.</summary>
    public sealed class IolPositions
    {
        [JsonPropertyName("account")] public string? Account { get; set; }
        /// <summary>Moneda de valuación.</summary>
        [JsonPropertyName("currency")] public string? Currency { get; set; }
        [JsonPropertyName("positions")] public List<IolPosition>? Positions { get; set; }
        [JsonPropertyName("total_market_value")] public decimal? TotalMarketValue { get; set; }
    }

    public sealed class IolPosition
    {
        [JsonPropertyName("instrument")] public IolInstrument? Instrument { get; set; }
        [JsonPropertyName("quantity")] public decimal? Quantity { get; set; }
        [JsonPropertyName("cost_basis")] public IolCostBasis? CostBasis { get; set; }
        [JsonPropertyName("market_value")] public IolMarketValue? MarketValue { get; set; }
        [JsonPropertyName("profit_loss")] public IolProfitLoss? ProfitLoss { get; set; }
    }

    public sealed class IolInstrument
    {
        [JsonPropertyName("symbol")] public string? Symbol { get; set; }
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("type")] public string? Type { get; set; }
        [JsonPropertyName("asset_class")] public string? AssetClass { get; set; }
        [JsonPropertyName("exchange")] public string? Exchange { get; set; }
        [JsonPropertyName("currency")] public string? Currency { get; set; }
        [JsonPropertyName("lot_size")] public decimal? LotSize { get; set; }
    }

    public sealed class IolCostBasis
    {
        [JsonPropertyName("average_entry_price")] public decimal? AverageEntryPrice { get; set; }
        [JsonPropertyName("total_cost")] public decimal? TotalCost { get; set; }
    }

    public sealed class IolMarketValue
    {
        [JsonPropertyName("current_price")] public decimal? CurrentPrice { get; set; }
    }

    public sealed class IolProfitLoss
    {
        [JsonPropertyName("unrealized_pl")] public decimal? UnrealizedPl { get; set; }
        [JsonPropertyName("unrealized_pl_percent")] public decimal? UnrealizedPlPercent { get; set; }
    }

    /// <summary>IOL rechazó el usuario o la contraseña (400/401 del login). Mismo <see cref="Code"/> que el de Tastytrade.</summary>
    public sealed class IolCredentialInvalidException : Exception
    {
        public const string Code = "broker_credential_invalid";

        public IolCredentialInvalidException()
            : base("IOL rechazó el usuario o la contraseña. Revisalos en Configuración › Conexiones › Brokers y confirmá que tengas la API activada en tu cuenta de IOL.")
        {
        }
    }
}
