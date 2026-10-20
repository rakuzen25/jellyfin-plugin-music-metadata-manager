using MusicMetadataManager;
using Xunit;

namespace MusicMetadataManager.Tests;
public sealed class IdentityContracts
{
    private static ArtistIdentity Identity() => new()
    {
        PreferredName = "天神子兎音",
        Aliases = ["Kotone", "Cafe\u0301"],
        Libraries = ["music"],
        ArtistId = Guid.NewGuid(),
        PersonId = Guid.NewGuid()
    };
    [Theory]
    [InlineData("kotone", true)]
    [InlineData("Café", true)]
    [InlineData("Kotone × Other", false)]
    public void NamesUseCaseInsensitiveNfcWithoutSplittingCollaborations(string term, bool match) => Assert.Equal(match, IdentityEngine.Matches(Identity(), term));
    [Theory]
    [InlineData("Kotone", 100)]
    [InlineData("Koto", 80)]
    [InlineData("otone", 50)]
    [InlineData("absent", 0)]
    public void SearchDistinguishesExactPrefixSubstringAndMissing(string term, int score) => Assert.Equal(score, IdentityEngine.SearchScore(Identity(), term));
    [Fact]
    public void OverlappingNamesAreRejectedWithinScopeOnly()
    {
        var a = Identity();
        var b = Identity();
        Assert.NotEmpty(IdentityEngine.Validate([a, b]));
        b.Libraries = ["other"];
        Assert.Empty(IdentityEngine.Validate([a, b]));
    }
}
