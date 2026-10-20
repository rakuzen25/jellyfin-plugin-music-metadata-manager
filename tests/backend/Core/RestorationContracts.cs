using System.Text.Json;
using MusicMetadataManager;
using Xunit;

namespace MusicMetadataManager.Tests;
public sealed class RestorationContracts
{
    [Theory]
    [InlineData("Managed", false, false, "Original")]
    [InlineData("Provider changed", false, false, "Provider changed")]
    [InlineData("Provider changed", true, false, "Original")]
    [InlineData("Provider changed", false, true, "Original")]
    public void ReleasingFieldsPreservesFreshProviderValuesUnlessLocked(string current, bool locked, bool titleLocked, string expected)
    {
        var actual = new View
        {
            Locked = locked,
            TitleLocked = titleLocked,
            Values = new()
            {
                ["title"] = JsonSerializer.SerializeToElement(current)
            }
        };
        var prior = new ManagedRecord
        {
            Original = new()
            {
                ["title"] = JsonSerializer.SerializeToElement("Original")
            },
            Applied = new()
            {
                ["title"] = JsonSerializer.SerializeToElement("Managed")
            }
        };
        Assert.Equal(expected, FieldRestoration.Release(actual, prior, "title").GetString());
    }

    [Fact]
    public void BaselineDoesNotMutateTheObservedMetadata()
    {
        var actual = new View
        {
            Values = new()
            {
                ["title"] = JsonSerializer.SerializeToElement("Managed")
            }
        };
        var prior = new ManagedRecord
        {
            Original = new()
            {
                ["title"] = JsonSerializer.SerializeToElement("Original")
            },
            Applied = new()
            {
                ["title"] = actual.Values["title"]
            }
        };
        Assert.Equal("Original", FieldRestoration.Baseline(actual, prior).Values["title"].GetString());
        Assert.Equal("Managed", actual.Values["title"].GetString());
    }

    [Theory]
    [InlineData("{\"title\":\"Old scalar form\"}")]
    [InlineData("{\"decisions\":null}")]
    [InlineData("{\"decisions\":{},\"unknown\":1}")]
    public void FieldMapRejectsNoncurrentOrIncompleteRepresentations(string json) => Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<Fields>(json, Codec.Json));
}
