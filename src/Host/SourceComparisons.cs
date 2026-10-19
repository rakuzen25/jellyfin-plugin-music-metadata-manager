using System.Text.Json;
using System.Security.Cryptography;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Providers;

namespace MusicMetadataManager;
public sealed record Comparison(Guid ItemId, SourceSnapshot Snapshot, RemoteImageInfo[] Images, string[] Notes);
public sealed class SourceState
{
    public System.Collections.Concurrent.ConcurrentDictionary<string, Comparison> Comparisons { get; set; } = [];
}

public sealed class SourceComparisons(ILibraryManager library, IHttpClientFactory http, IPluginStorage storage, IClock clock, ArtworkService artwork, ISourceLookup lookup)
{
    readonly SemaphoreSlim gate = new(1, 1);
    DateTime lastMusicBrainz;
    SourceState? state;
    string PathName => Path.Combine(storage.DirectoryPath, "sources.json");

    SourceState State => state ??= File.Exists(PathName) ? JsonSerializer.Deserialize<SourceState>(File.ReadAllText(PathName), Codec.Json) ?? throw new InvalidDataException("Empty source comparison state") : new();

    void Save() => AtomicJson.Write(PathName, State);
    public Comparison RequireImage(ImageCacheRequest request) => State.Comparisons.TryGetValue(request.SnapshotId, out var comparison) && comparison.ItemId == request.ItemId && comparison.Images.Any(x => x.Url == request.Url && x.Type.ToString() == request.Type) ? comparison : throw new ArgumentException("Select an image offered by a confirmed comparison for this item");
    public SourceProviderInfo[] Providers(BaseItem item)
    {
        if (item is Person)
            item = new MusicArtist
            {
                Name = item.Name,
                ProviderIds = new(item.ProviderIds),
                Path = item.Path
            };
        return item switch
        {
            MusicArtist a => lookup.Artists(a, a).Select(x => new SourceProviderInfo(x.Name, x.Name == "MusicBrainz" ? "MusicBrainzArtist" : x.Name == "Apple Music" ? "ITunesArtist" : null)).ToArray(),
            MusicAlbum a => lookup.Albums(a).Select(x => new SourceProviderInfo(x.Name, x.Name == "MusicBrainz" ? "MusicBrainzAlbum" : x.Name == "Apple Music" ? "ITunesCollection" : null)).ToArray(),
            _ => Array.Empty<SourceProviderInfo>()};
    }

    public async Task<Comparison> Compare(CompareRequest request, CancellationToken token)
    {
        if (!request.Confirm)
            throw new ArgumentException("Explicitly confirm this item's source record before fetching a comparison.");
        if (string.IsNullOrWhiteSpace(request.Provider) || string.IsNullOrWhiteSpace(request.Key) || string.IsNullOrWhiteSpace(request.RecordId))
            throw new ArgumentException("Select a provider and explicit source record ID.");
        var item = library.GetItemById(request.ItemId) ?? throw new ArgumentException("Item not found");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(40));
        await gate.WaitAsync(timeout.Token);
        try
        {
            BaseItem? fetched = null;
            BaseItem detached;
            if (item is MusicArtist or Person)
            {
                var artist = item as MusicArtist ?? new MusicArtist
                {
                    Name = item.Name,
                    ProviderIds = new(item.ProviderIds)
                };
                var info = lookup.Artist(artist);
                info.ProviderIds = new()
                {
                    {
                        request.Key,
                        request.RecordId
                    }
                };
                var remote = lookup.Artists(artist, item).SingleOrDefault(x => x.Name == request.Provider) ?? throw new ArgumentException("Installed source unavailable");
                // An explicit-ID lookup validates the binding; no native Identify, refresh or persistence is invoked.
                var matches = (await remote.GetSearchResults(info, timeout.Token)).Where(x => x.ProviderIds.TryGetValue(request.Key, out var id) && id == request.RecordId).ToArray();
                if (matches.Length != 1)
                    throw new ArgumentException("Source did not resolve this explicit ID uniquely; binding is not confirmed.");
                var result = await remote.GetMetadata(info, timeout.Token);
                if (!result.HasMetadata)
                    throw new InvalidOperationException("Source has no metadata for the selected binding");
                fetched = result.Item;
                detached = new MusicArtist
                {
                    Name = item.Name,
                    ProviderIds = new()
                    {
                        {
                            request.Key,
                            request.RecordId
                        }
                    }
                };
            }
            else if (item is MusicAlbum album)
            {
                var info = lookup.Album(album);
                info.ProviderIds = new()
                {
                    {
                        request.Key,
                        request.RecordId
                    }
                };
                var remote = lookup.Albums(album).SingleOrDefault(x => x.Name == request.Provider) ?? throw new ArgumentException("Installed source unavailable");
                var matches = (await remote.GetSearchResults(info, timeout.Token)).Where(x => x.ProviderIds.TryGetValue(request.Key, out var id) && id == request.RecordId).ToArray();
                if (matches.Length != 1)
                    throw new ArgumentException("Source binding was not resolved uniquely");
                var result = await remote.GetMetadata(info, timeout.Token);
                if (!result.HasMetadata)
                    throw new InvalidOperationException("Source has no metadata");
                fetched = result.Item;
                detached = new MusicAlbum
                {
                    Name = item.Name,
                    ProviderIds = new()
                    {
                        {
                            request.Key,
                            request.RecordId
                        }
                    }
                };
            }
            else
                throw new ArgumentException("No installed remote metadata source is available for this record type");
            var configured = NativeMetadata.Read(fetched!);
            var offered = new Dictionary<string, JsonElement>(configured);
            List<string> notes = ["Provider metadata was fetched into a detached result; no native refresh or Identify was run.", "Empty provider values are unavailable; approving an empty value is a separate manual decision."];
            if (request.Provider == "MusicBrainz")
            {
                if (!Guid.TryParse(request.RecordId, out _))
                    throw new ArgumentException("MusicBrainz IDs must be GUIDs");
                var delay = lastMusicBrainz.AddSeconds(1.1) - clock.UtcNow;
                if (delay > TimeSpan.Zero)
                    await Task.Delay(delay, timeout.Token);
                lastMusicBrainz = clock.UtcNow;
                var client = http.CreateClient();
                using var msg = new HttpRequestMessage(HttpMethod.Get, "https://musicbrainz.org/ws/2/" + (item is MusicAlbum ? "release/" : "artist/") + Uri.EscapeDataString(request.RecordId) + "?fmt=json");
                msg.Headers.UserAgent.ParseAdd("MusicMetadataManager/0.3.0 (https://github.com/jellyfin/jellyfin)");
                using var response = await client.SendAsync(msg, timeout.Token);
                response.EnsureSuccessStatusCode();
                using var raw = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(timeout.Token));
                if (raw.RootElement.TryGetProperty("name", out var name))
                    offered["title"] = name.Clone();
                else if (raw.RootElement.TryGetProperty("title", out name))
                    offered["title"] = name.Clone();
                if (raw.RootElement.TryGetProperty("sort-name", out var sort))
                    offered["sortName"] = sort.Clone();
                if (raw.RootElement.TryGetProperty("country", out var country))
                    offered["country"] = JsonSerializer.SerializeToElement(new[] { country.GetString() });
                // Keep incomplete source dates as strings in the offered snapshot. Native date application validates completeness.
                if (raw.RootElement.TryGetProperty("life-span", out var span))
                {
                    foreach (var(source, target)in new[]
                    {
                        ("begin", "premiereDate"),
                        ("end", "endDate")
                    }

                    )
                        if (span.TryGetProperty(source, out var date) && date.ValueKind == JsonValueKind.String)
                        {
                            offered[target] = date.Clone();
                            if (source == "begin" && date.GetString()is { Length: >= 4 } text && int.TryParse(text[..4], out var year) && year > 0)
                                offered["productionYear"] = JsonSerializer.SerializeToElement(year);
                        }
                }

                if (raw.RootElement.TryGetProperty("date", out var releaseDate))
                    offered["premiereDate"] = releaseDate.Clone();
                notes.Add("Offered values include a source-specific MusicBrainz comparison; configured values reflect the installed provider and its replacement settings. MusicBrainz does not supply an artist biography.");
            }

            var images = await lookup.Images(detached, request.Provider, timeout.Token);
            var binding = new SourceBinding
            {
                Provider = request.Provider,
                Key = request.Key,
                RecordId = request.RecordId,
                ConfirmedAt = clock.UtcNow
            };
            var snapshot = new SourceSnapshot
            {
                Binding = binding,
                RetrievedAt = clock.UtcNow,
                Configured = configured,
                Offered = offered
            };
            var comparison = new Comparison(item.Id, snapshot, images.ToArray(), notes.ToArray());
            State.Comparisons[snapshot.Id] = comparison;
            try
            {
                Save();
            }
            catch
            {
                State.Comparisons.TryRemove(snapshot.Id, out _);
                throw;
            }

            return comparison;
        }
        finally
        {
            gate.Release();
        }
    }

    public void ValidatePolicy(MetadataPolicy policy, IEnumerable<Guid> targets)
    {
        var allowedTargets = targets.ToHashSet();
        foreach (var snapshot in policy.Snapshots)
        {
            if (!State.Comparisons.TryGetValue(snapshot.Id, out var issued) || !allowedTargets.Contains(issued.ItemId) || Codec.Hash(issued.Snapshot) != Codec.Hash(snapshot))
                throw new ArgumentException("Imported source snapshots require a new confirmed comparison for their target before activation");
        }

        foreach (var field in policy.Fields.Values.Where(x => x.SnapshotId is not null && x.Mode == "approved"))
        {
            var source = policy.Snapshots.SingleOrDefault(x => x.Id == field.SnapshotId) ?? throw new ArgumentException("Missing source snapshot");
            if (field.SourceField is null || !source.Offered.TryGetValue(field.SourceField, out var offered) || !Engine.Equal(offered, field.Value))
                throw new ArgumentException("Approved provider value does not match its source snapshot");
        }

        foreach (var image in policy.Images.Values.Where(x => x.Mode == "approved"))
        {
            if (!artwork.HasImage(image.Hash!))
                throw new ArgumentException("Approved artwork is missing or its hash changed; cache and preview it again");
            if (image.SnapshotId is not null && (!policy.Snapshots.Any(s => s.Id == image.SnapshotId) || !State.Comparisons.TryGetValue(image.SnapshotId, out var issued) || !issued.Images.Any(i => i.Url == image.SourceUrl)))
                throw new ArgumentException("Artwork source requires its confirmed comparison snapshot");
        }

        foreach (var snapshot in policy.Snapshots)
            if (!policy.Bindings.Any(x => Codec.Hash(x) == Codec.Hash(snapshot.Binding)))
                throw new ArgumentException("Confirm each snapshot's provider binding");
    }
}
