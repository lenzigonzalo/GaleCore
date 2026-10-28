using DataFeed.Application.App.Runtime;

namespace DataFeed.Tests;

/// <summary>
/// Congela el comportamiento de StrategySpecHasher (P0 §4.4):
/// determinismo, canonicalización JCS, exclusión de content_hash.
/// </summary>
public class StrategySpecHasherTests
{
    private const string SampleJson = """
        {
          "strategy_spec_version": "1.0.0",
          "content_hash": null,
          "identity": { "id": "test", "name": "test" }
        }
        """;

    [Fact]
    public void SameContent_ProducesSameHash()
    {
        var hash1 = StrategySpecHasher.ComputeHash(SampleJson);
        var hash2 = StrategySpecHasher.ComputeHash(SampleJson);
        Assert.Equal(hash1, hash2);
    }

    [Fact]
    public void Hash_StartsWithSha256Prefix()
    {
        var hash = StrategySpecHasher.ComputeHash(SampleJson);
        Assert.StartsWith("sha256:", hash);
    }

    [Fact]
    public void Hash_IsHexAfterPrefix()
    {
        var hash = StrategySpecHasher.ComputeHash(SampleJson);
        var hex = hash["sha256:".Length..];
        Assert.Equal(64, hex.Length); // SHA-256 = 32 bytes = 64 hex chars
        Assert.True(hex.All(c => "0123456789abcdef".Contains(c)));
    }

    [Fact]
    public void ContentHash_ExcludedFromCalculation()
    {
        var json1 = """{"content_hash": null, "identity": {"id": "test"}}""";
        var json2 = """{"content_hash": "sha256:old_value", "identity": {"id": "test"}}""";

        var hash1 = StrategySpecHasher.ComputeHash(json1);
        var hash2 = StrategySpecHasher.ComputeHash(json2);

        // El hash se calcula sin content_hash, así que ambos deben dar lo mismo
        Assert.Equal(hash1, hash2);
    }

    [Fact]
    public void DifferentFormatting_SameHash()
    {
        var compact = """{"identity":{"id":"test","name":"a"}}""";
        var indented = """
            {
              "identity": {
                "id": "test",
                "name": "a"
              }
            }
            """;

        var hash1 = StrategySpecHasher.ComputeHash(compact);
        var hash2 = StrategySpecHasher.ComputeHash(indented);
        Assert.Equal(hash1, hash2);
    }

    [Fact]
    public void DifferentKeyOrder_SameHash()
    {
        var order1 = """{"a": 1, "b": 2}""";
        var order2 = """{"b": 2, "a": 1}""";

        var hash1 = StrategySpecHasher.ComputeHash(order1);
        var hash2 = StrategySpecHasher.ComputeHash(order2);
        Assert.Equal(hash1, hash2);
    }

    [Fact]
    public void DifferentContent_DifferentHash()
    {
        var json1 = """{"identity": {"id": "test1"}}""";
        var json2 = """{"identity": {"id": "test2"}}""";

        var hash1 = StrategySpecHasher.ComputeHash(json1);
        var hash2 = StrategySpecHasher.ComputeHash(json2);
        Assert.NotEqual(hash1, hash2);
    }

    [Fact]
    public void Canonicalize_SortsKeysLexicographically()
    {
        var json = """{"z": 1, "a": 2, "m": 3}""";
        var node = System.Text.Json.Nodes.JsonNode.Parse(json)!;
        var canonical = StrategySpecHasher.Canonicalize(node);
        Assert.Equal("""{"a":2,"m":3,"z":1}""", canonical);
    }

    [Fact]
    public void Canonicalize_NestedObjects_SortedRecursively()
    {
        var json = """{"b": {"z": 1, "a": 2}, "a": 0}""";
        var node = System.Text.Json.Nodes.JsonNode.Parse(json)!;
        var canonical = StrategySpecHasher.Canonicalize(node);
        Assert.Equal("""{"a":0,"b":{"a":2,"z":1}}""", canonical);
    }

    [Fact]
    public void Canonicalize_ArrayOrder_Preserved()
    {
        var json = """{"items": [3, 1, 2]}""";
        var node = System.Text.Json.Nodes.JsonNode.Parse(json)!;
        var canonical = StrategySpecHasher.Canonicalize(node);
        Assert.Equal("""{"items":[3,1,2]}""", canonical);
    }
}
