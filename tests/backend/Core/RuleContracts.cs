using System.Text.Json;
using MusicMetadataManager;
using Xunit;

namespace MusicMetadataManager.Tests;
public sealed class RuleContracts
{
    private static Rule Rule(string kind = "track", string path = "/music/album/track.flac") => new()
    {
        Kind = kind,
        Path = path,
        Libraries = ["music"]
    };
    private static View Track(string[]? artists = null) => new()
    {
        Path = "/music/album/track.flac",
        AlbumPath = "/music/album",
        Library = "music",
        Values = new Fields
        {
            Title = "Original",
            Album = "Original album",
            Artists = artists ?? ["Original artist"],
            AlbumArtists = ["Album artist"],
            DiscNumber = 1,
            TrackNumber = 1
        }.Values()
    };
    [Fact]
    public void ExactTrackWinsOverAlbumDefaultsWithoutManagingUnspecifiedFields()
    {
        var album = Rule("album", "/music/album");
        album.Fields.Title = "Album";
        album.TrackDefaults.DiscNumber = 1;
        var track = Rule();
        track.Fields.DiscNumber = 2;
        track.Fields.TrackNumber = 3;
        var values = Engine.Project(Track(), [album, track]).Values;
        Assert.Equal(2, values["discNumber"].GetInt32());
        Assert.Equal(3, values["trackNumber"].GetInt32());
        Assert.Equal("Album", values["album"].GetString());
        Assert.False(values.ContainsKey("title"));
    }

    [Theory]
    [InlineData("artists", true, false)]
    [InlineData("albumArtists", false, true)]
    [InlineData("both", true, true)]
    public void CreditRoleControlsWhichListsAreManaged(string role, bool performers, bool albumArtists)
    {
        var alias = Rule("alias", "");
        alias.Credit = "A × B";
        alias.Names = ["A", "B"];
        alias.Role = role;
        var view = Track([alias.Credit]);
        view.Values["albumArtists"] = JsonSerializer.SerializeToElement(new[] { alias.Credit });
        var values = Engine.Project(view, [alias]).Values;
        Assert.Equal(performers, values.ContainsKey("artists"));
        Assert.Equal(albumArtists, values.ContainsKey("albumArtists"));
    }

    [Theory]
    [InlineData("Leo/need feat. 星乃一歌&初音ミク")]
    [InlineData("缶缶\u00a0feat.\u00a0Ayase")]
    public void MappingsPreserveExactUnicodePunctuationAndWhitespace(string credit)
    {
        var alias = Rule("alias", "");
        alias.Credit = credit;
        alias.Names = ["Leo/need", "星乃一歌"];
        Assert.Equal(alias.Names, Engine.Project(Track([credit]), [alias]).Values["artists"].Deserialize<string[]>());
        Assert.Empty(Engine.Project(Track([credit + " "]), [alias]).Values);
    }

    [Fact]
    public void AliasExpansionDoesNotChainAndExplicitTrackCreditsWin()
    {
        var alias = Rule("alias", "");
        alias.Credit = "A + B";
        alias.Names = ["A", "B"];
        var chained = Rule("alias", "");
        chained.Credit = "A";
        chained.Names = ["Other"];
        Assert.Equal(new[] { "A", "B" }, Engine.Project(Track([alias.Credit]), [alias, chained]).Values["artists"].Deserialize<string[]>());
        var exact = Rule();
        exact.Fields.Artists = ["Explicit"];
        Assert.Equal(new[] { "Explicit" }, Engine.Project(Track([alias.Credit]), [alias, exact]).Values["artists"].Deserialize<string[]>());
    }

    [Fact]
    public void LibraryScopeAndDraftIsolationAreRespectedEvenForLockedItems()
    {
        var rule = Rule();
        rule.Fields.Title = "Managed";
        var view = Track();
        view.Locked = true;
        Assert.Equal("Managed", Engine.Project(view, [rule]).Values["title"].GetString());
        view.Library = "other";
        Assert.Empty(Engine.Project(view, [rule]).Values);
        Assert.Empty(Engine.Project(Track(), new Document { Drafts = [rule] }.Active).Values);
    }

    [Fact]
    public void OverlappingDecisionsConflictButDisjointLibrariesDoNot()
    {
        var a = Rule();
        a.Fields.Title = "A";
        var b = Rule();
        b.Fields.Title = "B";
        Assert.Contains(Engine.Validate([a, b]), e => e.Contains("Conflicting"));
        b.Libraries = ["other"];
        Assert.Empty(Engine.Validate([a, b]));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void TrackNumbersMustBePositive(int number)
    {
        var rule = Rule();
        rule.Fields.TrackNumber = number;
        Assert.NotEmpty(Engine.Validate([rule]));
    }

    [Fact]
    public void AlbumRejectsTrackOnlyFieldsAndTrackRejectsDefaults()
    {
        var album = Rule("album", "/music/album");
        album.Fields.Album = "Wrong";
        Assert.NotEmpty(Engine.Validate([album]));
        var track = Rule();
        track.TrackDefaults.Title = "Wrong";
        Assert.NotEmpty(Engine.Validate([track]));
    }

    [Fact]
    public void FieldAccessorsShareOneCanonicalMap()
    {
        var fields = new Fields
        {
            Title = "First"
        };
        fields.Decisions["title"] = new()
        {
            Value = JsonSerializer.SerializeToElement("Second")
        };
        Assert.Equal("Second", fields.Title);
        Assert.Equal("Second", fields.Values()["title"].GetString());
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(fields, Codec.Json));
        Assert.Single(json.RootElement.EnumerateObject());
        Assert.True(json.RootElement.TryGetProperty("decisions", out _));
    }

    [Fact]
    public void CurrentDocumentRoundtripPreservesDraftsDecisionsAndIdentityRegistries()
    {
        var rule = Rule();
        rule.Fields.Title = "Unicode 星";
        var doc = new Document
        {
            Active = [rule],
            Drafts = [Rule()],
            Policies = [new()
            {
                ItemId = Guid.NewGuid(),
                Libraries = ["music"]
            }

            ]
        };
        Assert.Equal(Codec.Hash(doc), Codec.Hash(Codec.Clone(doc)));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<Document>("{}", Codec.Json));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<Document>("{\"schemaVersion\":1,\"active\":[],\"drafts\":[]}", Codec.Json));
    }

    [Fact]
    public void JsonEqualityIgnoresFormattingButPreservesArtistOrder()
    {
        using var a = JsonDocument.Parse("[ \"A\", \"B\" ]");
        using var b = JsonDocument.Parse("[\"A\",\"B\"]");
        Assert.True(Engine.Equal(a.RootElement, b.RootElement));
        Assert.False(Engine.Equal(a.RootElement, JsonSerializer.SerializeToElement(new[] { "B", "A" })));
    }
}
