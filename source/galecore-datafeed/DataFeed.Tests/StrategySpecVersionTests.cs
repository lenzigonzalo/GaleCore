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
        "sha256:19884e779e3722f6221cf86c03b411307cdc41e04880e26f8f88395cf960bc51";

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
        Assert.Equal("1.0.3", result.Spec.Identity.Version);
        Assert.Equal(new[] { "SHADOW" }, result.Spec.DeploymentConstraints.EligibleModes);
    }
}
