using DataFeed.Application.App.Runtime;

namespace DataFeed.Tests;

/// <summary>
/// Congela la versión de estrategia preparada para SHADOW (GC-AI-0008): GaleCore la carga y valida con su
/// propio loader, y su content_hash es exactamente el que se somete a aprobación. Si alguien edita el
/// archivo, el hash cambia y este test falla: una edición es otra versión, con otra aprobación.
/// </summary>
public class StrategySpecVersionTests
{
    private const string Name = "spy_prima_varianza_30_45d";
    private const string ApprovedCandidateHash =
        "sha256:dfed1af1efcc27a466f6e5894357157c8633422cf41b9f5e14869cabd52576f8";

    private static string SpecPath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "DataFeed.Api", "Files", "Runtime", Name + ".json");
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        throw new FileNotFoundException(Name + ".json no encontrado subiendo desde " + AppContext.BaseDirectory);
    }

    [Fact]
    public void LoadsValidatesAndHashesAsSubmitted()
    {
        var result = StrategySpecLoader.LoadFromFile(SpecPath());
        Assert.True(result.Success, string.Join("; ", result.Errors));
        Assert.Equal(ApprovedCandidateHash, result.ContentHash);
        Assert.Equal(Name, result.Spec!.Identity.Name);
        Assert.Equal("1.0.0", result.Spec.Identity.Version);
        Assert.Equal(new[] { "SHADOW" }, result.Spec.DeploymentConstraints.EligibleModes);
    }
}
