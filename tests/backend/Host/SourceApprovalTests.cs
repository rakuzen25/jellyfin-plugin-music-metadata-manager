using System.Reflection;
using System.Text.Json;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Configuration;
using MediaBrowser.Model.Providers;
using MusicMetadataManager;
using Xunit;

namespace MusicMetadataManager.Tests;
public sealed class SourceApprovalTests
{
    [Fact]
    public async Task DetachedComparisonNeverMutatesNativeMetadataAndRejectsTamperedSnapshots()
    {
        using var fixture = new Fixture();
        var comparison = await fixture.Compare(TestContext.Current.CancellationToken);
        Assert.Equal("Native album", fixture.Library.Album.Name);
        Assert.Equal("Offered biography", comparison.Snapshot.Offered["overview"].GetString());
        var policy = fixture.Policy(comparison);
        fixture.Service.ValidatePolicy(policy, [fixture.Library.Album.Id]);
        policy.Snapshots[0].Offered["overview"] = JsonSerializer.SerializeToElement("Tampered");
        Assert.Throws<ArgumentException>(() => fixture.Service.ValidatePolicy(policy, [fixture.Library.Album.Id]));
        Assert.Equal("Native album", fixture.Library.Album.Name);
    }

    [Fact]
    public async Task ProviderFailureAndCallerCancellationLeaveNativeMetadataUnchanged()
    {
        using var fixture = new Fixture();
        fixture.Provider.Fail = true;
        await Assert.ThrowsAsync<HttpRequestException>(() => fixture.Compare(TestContext.Current.CancellationToken));
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => fixture.Compare(cancelled.Token));
        Assert.Equal("Native album", fixture.Library.Album.Name);
    }

    [Fact]
    public async Task MissingPinnedArtworkAndForeignTargetSnapshotsCannotBeApproved()
    {
        using var fixture = new Fixture();
        var comparison = await fixture.Compare(TestContext.Current.CancellationToken);
        Assert.Throws<ArgumentException>(() => fixture.Service.ValidatePolicy(fixture.Policy(comparison), [Guid.NewGuid()]));
        var policy = fixture.Policy(comparison);
        policy.Images["Primary"] = new()
        {
            Hash = new string ('A', 64),
            Mime = "image/png"
        };
        Assert.Throws<ArgumentException>(() => fixture.Service.ValidatePolicy(policy, [fixture.Library.Album.Id]));
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string directory = Path.Combine(Path.GetTempPath(), "source-approval-" + Guid.NewGuid());
        public SourceLibrary Library { get; }
        public FixtureProvider Provider { get; } = new();
        public SourceComparisons Service { get; }

        public Fixture()
        {
            var library = DispatchProxy.Create<ILibraryManager, SourceLibrary>();
            Library = (SourceLibrary)(object)library;
            var storage = new PluginStorage(directory);
            Service = new(library, null!, storage, new Clock(), new ArtworkService(null!, null!, new PinnedImages(storage)), new Lookup(Provider));
        }

        public Task<Comparison> Compare(CancellationToken cancellation = default) => Service.Compare(new() { ItemId = Library.Album.Id, Provider = "Fixture", Key = "FixtureAlbum", RecordId = "confirmed", Confirm = true }, cancellation);
        public MetadataPolicy Policy(Comparison comparison) => new()
        {
            ItemId = Library.Album.Id,
            Libraries = ["music"],
            Bindings = [comparison.Snapshot.Binding],
            Snapshots = [Codec.Clone(comparison.Snapshot)],
            Fields = new()
            {
                ["overview"] = new()
                {
                    Value = comparison.Snapshot.Offered["overview"],
                    SnapshotId = comparison.Snapshot.Id,
                    SourceField = "overview"
                }
            }
        };
        public void Dispose()
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, true);
        }
    }

    private sealed class Lookup(FixtureProvider provider) : ISourceLookup
    {
        public ArtistInfo Artist(MusicArtist artist) => new()
        {
            Name = artist.Name
        };
        public AlbumInfo Album(MusicAlbum album) => new()
        {
            Name = album.Name
        };
        public IEnumerable<IRemoteMetadataProvider<MusicArtist, ArtistInfo>> Artists(MusicArtist artist, MediaBrowser.Controller.Entities.BaseItem source) => [];
        public IEnumerable<IRemoteMetadataProvider<MusicAlbum, AlbumInfo>> Albums(MusicAlbum album) => [provider];
        public Task<RemoteImageInfo[]> Images(MediaBrowser.Controller.Entities.BaseItem detached, string name, CancellationToken token) => Task.FromResult<RemoteImageInfo[]>([]);
    }

    private sealed class Clock : IClock
    {
        public DateTime UtcNow => new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    }
}

public class SourceLibrary : DispatchProxy
{
    public MusicAlbum Album { get; } = new()
    {
        Id = Guid.NewGuid(),
        Name = "Native album",
        Path = "/fixture/album"
    };

    protected override object? Invoke(MethodInfo? method, object? []? args) => method?.Name switch
    {
        "GetItemById" => Album,
        "GetLibraryOptions" => new LibraryOptions(),
        _ => throw new InvalidOperationException("Unexpected source library access: " + method?.Name)};
}

public sealed class FixtureProvider : IRemoteMetadataProvider<MusicAlbum, AlbumInfo>
{
    public string Name => "Fixture";
    public bool Fail { get; set; }

    public Task<IEnumerable<RemoteSearchResult>> GetSearchResults(AlbumInfo info, CancellationToken token) => Fail ? Task.FromException<IEnumerable<RemoteSearchResult>>(new HttpRequestException("Synthetic provider failure")) : Task.FromResult<IEnumerable<RemoteSearchResult>>([new() { Name = "Provider album", ProviderIds = new() { ["FixtureAlbum"] = "confirmed" } }]);
    public Task<MetadataResult<MusicAlbum>> GetMetadata(AlbumInfo info, CancellationToken token) => Task.FromResult(new MetadataResult<MusicAlbum> { HasMetadata = true, Item = new() { Name = "Provider album", Overview = "Offered biography" } });
    public Task<HttpResponseMessage> GetImageResponse(string url, CancellationToken token) => throw new InvalidOperationException("Comparison must not download artwork");
}
