using System.Text.Json;
using MusicMetadataManager;
using Xunit;

namespace MusicMetadataManager.Tests;
public sealed class MetadataContracts
{
    [Theory]
    [InlineData("overview", "empty", true)]
    [InlineData("overview", "unmanaged", false)]
    public void EmptyAndUnmanagedAreDistinct(string field, string mode, bool managed)
    {
        var values = MetadataEngine.Values(new() { [field] = new() { Mode = mode } });
        Assert.Equal(managed, values.ContainsKey(field));
        if (managed)
            Assert.Equal(JsonValueKind.Null, values[field].ValueKind);
    }

    [Theory]
    [InlineData("title")]
    [InlineData("album")]
    [InlineData("artists")]
    [InlineData("albumArtists")]
    [InlineData("discNumber")]
    [InlineData("trackNumber")]
    [InlineData("isLocked")]
    public void RequiredFieldsCannotBeExplicitlyEmpty(string field) => Assert.NotEmpty(MetadataEngine.ValidateFields(new() { [field] = new() { Mode = "empty" } }));
    [Theory]
    [InlineData("2018", false)]
    [InlineData("2018-06", false)]
    [InlineData("2018-06-11", true)]
    [InlineData("2025-02-30", false)]
    public void NativeDatesMustBeCompleteAndReal(string date, bool valid) => Assert.Equal(valid, MetadataEngine.ValidateFields(new() { ["premiereDate"] = new() { Value = JsonSerializer.SerializeToElement(date) } }).Count == 0);
    [Theory]
    [InlineData("[]")]
    [InlineData("[null]")]
    [InlineData("[\"A\",\"a\"]")]
    [InlineData("42")]
    public void InvalidArtistListsAreRejectedWithoutThrowing(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.NotEmpty(MetadataEngine.ValidateFields(new() { ["artists"] = new() { Value = doc.RootElement.Clone() } }));
    }

    [Fact]
    public void FieldCatalogHasOneEntryForEverySupportedField()
    {
        Assert.Equal(FieldCatalog.Definitions.Count, FieldCatalog.Definitions.Select(x => x.Name).Distinct().Count());
        Assert.Equal(FieldCatalog.Definitions.Select(x => x.Name).Order(), MetadataEngine.CoreFields.Concat(MetadataEngine.ExtendedFields).Order());
    }

    [Fact]
    public void NullDecisionsAndCollectionsReturnValidationFailures()
    {
        Assert.NotEmpty(MetadataEngine.ValidateFields(new() { ["overview"] = null! }));
        Assert.NotEmpty(MetadataEngine.ValidatePolicies([new() { ItemId = Guid.NewGuid(), Libraries = ["music"], Fields = null! }]));
        Assert.Throws<ArgumentException>(() => DocumentValidation.EnsureShape(new() { Drafts = [null!] }));
    }
}
