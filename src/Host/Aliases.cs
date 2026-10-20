using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Configuration;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace MusicMetadataManager;
public sealed record AliasMember(Guid Id, string Library, string[] Artists, string[] AlbumArtists, Guid ParentId, bool Album);
public sealed record AliasView(ArtistIdentity Identity, AliasMember[] Members);
public sealed class AliasService(ILibraryManager library, IUserManager users, IUserDataManager userData, IProviderManager providers, IHttpClientFactory http, ILogger<AliasService> logger, IDocumentReader configuration, IClock clock) : IHostedService
{
    readonly object cacheGate = new();
    readonly SemaphoreSlim favoriteGate = new(1, 1);
    long generation;
    (long Generation, long Revision, AliasMember[] Members)? cache;
    readonly ConcurrentQueue<string> errors = new();
    readonly SemaphoreSlim suggestionGate = new(1, 1);
    DateTime lastSuggestionCall;
    readonly ConcurrentDictionary<string, (DateTime Time, AliasSuggestionsResponse Data)> suggestionCache = new();
    public void Invalidate() => Interlocked.Increment(ref generation);
    void Changed(object? sender, ItemChangeEventArgs e) => Invalidate();
    void Refreshed(object? sender, Jellyfin.Data.Events.GenericEventArgs<BaseItem> e) => Invalidate();
    public Task StartAsync(CancellationToken token)
    {
        providers.RefreshCompleted += Refreshed;
        library.ItemAdded += Changed;
        library.ItemUpdated += Changed;
        library.ItemRemoved += Changed;
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken token)
    {
        providers.RefreshCompleted -= Refreshed;
        library.ItemAdded -= Changed;
        library.ItemUpdated -= Changed;
        library.ItemRemoved -= Changed;
        return Task.CompletedTask;
    }

    public static void ValidateBindings(ILibraryManager library, ArtistIdentity identity)
    {
        if (library.GetItemById(identity.ArtistId)is not MusicArtist || library.GetItemById(identity.PersonId)is not Person)
            throw new ArgumentException(identity.PreferredName + ": missing representative; select an existing MusicArtist and Person.");
        foreach (var id in identity.ArtistIds)
            if (library.GetItemById(id)is not MusicArtist)
                throw new ArgumentException(identity.PreferredName + ": missing linked artist " + id);
        foreach (var id in identity.PersonIds)
            if (library.GetItemById(id)is not Person)
                throw new ArgumentException(identity.PreferredName + ": missing linked person " + id);
    }

    public static IdentityReport[] Reports(ILibraryManager library, IEnumerable<ArtistIdentity> identities)
    {
        var folders = library.GetVirtualFolders().SelectMany(x => x.Locations.Select(p => (Id: x.ItemId, Path: p.TrimEnd('/') + "/"))).OrderByDescending(x => x.Path.Length).ToArray();
        var items = library.GetItemList(new InternalItemsQuery { Recursive = true, IncludeItemTypes = [BaseItemKind.Audio, BaseItemKind.MusicAlbum] });
        var knownLibraries = folders.Select(x => x.Id).ToHashSet();
        return identities.OrderBy(x => x.Id).Select(x =>
        {
            var bindings = x.Records.Select(id => new IdentityBindingInfo(id, library.GetItemById(id)?.Name, library.GetItemById(id)?.GetType().Name)).ToArray();
            var direct = items.Where(item => x.Libraries.Contains(folders.FirstOrDefault(f => item.Path?.StartsWith(f.Path, StringComparison.Ordinal) == true).Id) && (item is Audio a ? a.Artists.Concat(a.AlbumArtists) : ((MusicAlbum)item).Artists.Concat(((MusicAlbum)item).AlbumArtists)).Any(n => IdentityEngine.Matches(x, n))).ToArray();
            var parents = direct.OfType<Audio>().Select(a => a.ParentId).ToHashSet();
            var affected = items.Where(item => direct.Any(d => d.Id == item.Id) || item is MusicAlbum && parents.Contains(item.Id)).OrderBy(item => item.Id).Select(item => new IdentityAffectedItem(item.Id, item.Path, item is Audio ? "track" : "album", (item is Audio a ? a.Artists.Concat(a.AlbumArtists) : ((MusicAlbum)item).Artists.Concat(((MusicAlbum)item).AlbumArtists)).Where(n => IdentityEngine.Matches(x, n)).Distinct().ToArray(), x.ArtistId)).ToArray();
            return new IdentityReport(x.Id, x.PreferredName, x.Aliases, x.Libraries, bindings, affected, bindings.Where(b => b.Name is null).Select(b => b.Id).ToArray(), x.Libraries.Where(l => !knownLibraries.Contains(l)).ToArray(), "Any accessible linked record; writes apply to accessible linked records", "Unchanged", "Unchanged");
        }).ToArray();
    }

    public User? User(Guid? id) => id.HasValue ? users.GetUserById(id.Value) : null;
    public AliasMember[] Members()
    {
        lock (cacheGate)
        {
            var revision = configuration.Current.Revision;
            var g = Interlocked.Read(ref generation);
            if (cache is { } prior && prior.Generation == g && prior.Revision == revision)
                return prior.Members;
            var folders = library.GetVirtualFolders().Where(x => x.CollectionType?.ToString().Equals("music", StringComparison.OrdinalIgnoreCase) == true).SelectMany(x => x.Locations.Select(p => (Id: x.ItemId, Path: p.TrimEnd('/') + "/"))).OrderByDescending(x => x.Path.Length).ToArray();
            var items = library.GetItemList(new InternalItemsQuery { Recursive = true, IncludeItemTypes = [BaseItemKind.Audio, BaseItemKind.MusicAlbum] });
            var rows = items.Select(item =>
            {
                var scope = folders.FirstOrDefault(x => item.Path?.StartsWith(x.Path, StringComparison.Ordinal) == true);
                return item switch
                {
                    Audio a => new AliasMember(item.Id, scope.Id ?? "", a.Artists.ToArray(), a.AlbumArtists.ToArray(), item.ParentId, false),
                    MusicAlbum a => new AliasMember(item.Id, scope.Id ?? "", a.Artists.ToArray(), a.AlbumArtists.ToArray(), item.ParentId, true),
                    _ => throw new InvalidOperationException()};
            }).Where(x => x.Library != "").ToArray();
            cache = (g, revision, rows);
            return rows;
        }
    }

    public AliasView[] Views(User? user, Guid? parent = null, IEnumerable<ArtistIdentity>? identities = null)
    {
        // No user context means no alias expansion; never return a privileged unfiltered index.
        if (user is null)
            return[];
        var q = new InternalItemsQuery(user)
        {
            Recursive = true,
            IncludeItemTypes = [BaseItemKind.Audio, BaseItemKind.MusicAlbum]
        };
        if (parent.HasValue && parent != Guid.Empty)
            q.ParentId = parent.Value;
        library.ConfigureUserAccess(q, user);
        var accessible = library.GetItemList(q).Select(x => x.Id).ToHashSet();
        var members = Members().Where(x => accessible.Contains(x.Id)).ToArray();
        return (identities ?? configuration.Current.Identities).Select(identity =>
        {
            var direct = members.Where(x => identity.Libraries.Contains(x.Library) && x.Artists.Concat(x.AlbumArtists).Any(n => IdentityEngine.Matches(identity, n))).ToArray();
            var parents = direct.Where(x => !x.Album).Select(x => x.ParentId).ToHashSet();
            return new AliasView(Codec.Clone(identity), members.Where(x => direct.Any(d => d.Id == x.Id) || x.Album && parents.Contains(x.Id)).ToArray());
        }).Where(x => x.Members.Length > 0 && library.GetItemById(x.Identity.ArtistId) is MusicArtist && library.GetItemById(x.Identity.PersonId) is Person).ToArray();
    }

    public AliasView? ForId(Guid id, AliasView[] views)
    {
        var explicitView = views.FirstOrDefault(x => x.Identity.Records.Contains(id));
        if (explicitView is not null)
            return explicitView;
        var record = library.GetItemById(id);
        if (record is not MusicArtist && record is not Person)
            return null;
        return views.FirstOrDefault(x => IdentityEngine.Matches(x.Identity, record.Name));
    }

    public BaseItem[] AccessibleRecords(AliasView view) => view.Identity.Records.Select(library.GetItemById).OfType<BaseItem>().Concat(library.GetItemList(new InternalItemsQuery { IncludeItemTypes = [BaseItemKind.MusicArtist] }).Where(x => IdentityEngine.Matches(view.Identity, x.Name))).Concat(library.GetPeopleItems(new InternalPeopleQuery(["Artist", "AlbumArtist"], [])).Items.Where(x => IdentityEngine.Matches(view.Identity, x.Name))).DistinctBy(x => x.Id).Where(record => view.Members.Any(m => m.Artists.Concat(m.AlbumArtists).Any(name => IdentityEngine.Key(name) == IdentityEngine.Key(record.Name) || record.Path is not null && IdentityEngine.Key(name) == IdentityEngine.Key(Path.GetFileName(record.Path))))).ToArray();
    public bool Favorite(User user, AliasView view) => AccessibleRecords(view).Any(x => userData.GetUserData(user, x)?.IsFavorite == true);
    public BaseItemDto Representative(AliasView view, bool person, IDtoService dto, User user, DtoOptions? options = null)
    {
        var item = library.GetItemById(person ? view.Identity.PersonId : view.Identity.ArtistId)!;
        var value = dto.GetBaseItemDto(item, options ?? new DtoOptions(true), user);
        Overlay(value, user, [view]);
        return value;
    }

    public void Overlay(BaseItemDto dto, User user, AliasView[] views)
    {
        var identity = ForId(dto.Id, views);
        if (identity is not null)
        {
            dto.Name = identity.Identity.PreferredName;
            dto.SortName = identity.Identity.PreferredName;
            if (dto.UserData is not null)
                dto.UserData.IsFavorite = Favorite(user, identity);
            dto.SongCount = identity.Members.Count(x => !x.Album);
            dto.AlbumCount = identity.Members.Count(x => x.Album);
        }

        var member = Members().FirstOrDefault(x => x.Id == dto.Id);
        if (member is null)
            return;
        NameGuidPair[] Links(string[] credits, NameGuidPair[]? old) => credits.Select(credit =>
        {
            var v = views.FirstOrDefault(x => x.Identity.Libraries.Contains(member.Library) && IdentityEngine.Matches(x.Identity, credit));
            return v is null ? old?.FirstOrDefault(x => x.Name == credit) : new NameGuidPair
            {
                Name = credit,
                Id = v.Identity.ArtistId
            };
        }).Where(x => x is not null).Select(x => x!).DistinctBy(x => (x.Name, x.Id)).ToArray();
        dto.ArtistItems = Links(member.Artists, dto.ArtistItems);
        dto.AlbumArtists = Links(member.AlbumArtists, dto.AlbumArtists);
        if (dto.People is not null)
            foreach (var person in dto.People.Where(x => x.Type is PersonKind.Artist or PersonKind.AlbumArtist))
            {
                var v = views.FirstOrDefault(x => x.Identity.Libraries.Contains(member.Library) && IdentityEngine.Matches(x.Identity, person.Name));
                if (v is not null)
                    person.Id = v.Identity.PersonId;
            }
    }

    public async Task<UserItemDataDto?> SetFavorite(User user, AliasView view, bool value, CancellationToken token)
    {
        await favoriteGate.WaitAsync(token);
        var items = AccessibleRecords(view);
        // Membership was filtered for this user; only artist/person records in this identity are updated.
        Dictionary<Guid, UserItemData> before = [];
        List<BaseItem> written = [];
        try
        {
            before = items.ToDictionary(x => x.Id, x => Codec.Clone(userData.GetUserData(user, x) ?? new UserItemData { Key = x.GetUserDataKeys().First() }));
            foreach (var item in items)
            {
                var data = Codec.Clone(before[item.Id]);
                data.IsFavorite = value;
                written.Add(item);
                userData.SaveUserData(user, item, data, UserDataSaveReason.UpdateUserRating, token);
            }

            var dto = userData.GetUserDataDto(library.GetItemById(view.Identity.ArtistId)!, user);
            if (dto is not null)
                dto.IsFavorite = Favorite(user, view);
            return dto;
        }
        catch (Exception e)
        {
            foreach (var item in written)
                try
                {
                    userData.SaveUserData(user, item, before[item.Id], UserDataSaveReason.UpdateUserRating, CancellationToken.None);
                }
                catch (Exception restore)
                {
                    Report("Favorite restoration failed: " + restore.Message);
                }

            Report("Favorite update failed: " + e.Message);
            throw;
        }
        finally
        {
            favoriteGate.Release();
        }
    }

    void Report(string message)
    {
        errors.Enqueue(message);
        while (errors.Count > 50)
            errors.TryDequeue(out _);
        logger.LogError("{AliasError}", message);
    }

    public AliasStatusResponse Status() => new(Interlocked.Read(ref generation), errors.ToArray(), Reports(library, configuration.Current.Identities));
    public UnresolvedResponse Unresolved(User user, IDtoService dto)
    {
        var views = Views(user);
        var query = new InternalItemsQuery(user)
        {
            Recursive = true,
            IncludeItemTypes = [BaseItemKind.Audio, BaseItemKind.MusicAlbum]
        };
        library.ConfigureUserAccess(query, user);
        var accessible = library.GetItemList(query).ToDictionary(x => x.Id);
        var members = Members().Where(x => accessible.ContainsKey(x.Id)).ToArray();
        var artists = library.GetItemList(new InternalItemsQuery { IncludeItemTypes = [BaseItemKind.MusicArtist] });
        var persons = library.GetPeopleItems(new InternalPeopleQuery(["Artist", "AlbumArtist"], [])).Items;
        var missing = new List<(AliasMember Member, string Role, string Credit)>();
        var failures = new List<InspectionFailure>();
        foreach (var member in members)
        {
            try
            {
                var value = dto.GetBaseItemDto(accessible[member.Id], new DtoOptions(true), user);
                Overlay(value, user, views);
                foreach (var role in new[]
                {
                    "artists",
                    "albumArtists"
                }

                )
                {
                    var credits = role == "artists" ? member.Artists : member.AlbumArtists;
                    var links = role == "artists" ? value.ArtistItems : value.AlbumArtists;
                    foreach (var credit in credits.Distinct())
                        if (!(links ?? []).Any(x => IdentityEngine.Key(x.Name) == IdentityEngine.Key(credit) && x.Id != Guid.Empty && library.GetItemById(x.Id) is MusicArtist))
                            missing.Add((member, role, credit));
                }
            }
            catch (Exception e)
            {
                failures.Add(new InspectionFailure(member.Id, accessible[member.Id].Path, e.Message, e is UnauthorizedAccessException ? "inspection-access-denied" : e is IOException ? "inspection-io-failure" : "inspection-failed"));
            }
        }

        var rows = missing.GroupBy(x => (x.Member.Library, x.Role, Key: IdentityEngine.Key(x.Credit))).Select(group =>
        {
            var credit = group.First().Credit;
            bool Candidate(BaseItem record) => IdentityEngine.Key(record.Name) == group.Key.Key || record.Path is not null && IdentityEngine.Key(Path.GetFileName(record.Path.TrimEnd('/'))) == group.Key.Key;
            var candidates = artists.Where(Candidate).Select(x => new AliasCandidate(x.Id, x.Name, IdentityEngine.Key(x.Name) == group.Key.Key ? "name" : "metadata-folder name")).ToArray();
            var people = persons.Where(Candidate).Select(x => new AliasCandidate(x.Id, x.Name)).ToArray();
            var identity = configuration.Current.Identities.FirstOrDefault(x => x.Libraries.Contains(group.Key.Library) && IdentityEngine.Matches(x, credit));
            return new UnresolvedCredit(credit, group.Key.Role, group.Key.Library, identity?.Id, identity is not null ? "Active identity needs binding review" : candidates.Length > 0 ? "Stored artist record does not resolve this credit" : "No matching artist record found", candidates, people, group.Select(x => new UnresolvedItem(x.Member.Id, accessible[x.Member.Id].Name, accessible[x.Member.Id].Path, x.Member.Album ? "album" : "track")).DistinctBy(x => x.Id).OrderBy(x => x.Path).ToArray());
        }).OrderBy(x => x.Credit).ThenBy(x => x.Role).ThenBy(x => x.Library).ToArray();
        return new UnresolvedResponse(members.Length, rows.Length, rows, failures.ToArray());
    }

    public AliasRecordsResponse Records() => new(library.GetItemList(new InternalItemsQuery { IncludeItemTypes = [BaseItemKind.MusicArtist] }).Select(x => new AliasRecord(x.Id, x.Name, new(x.ProviderIds))).ToArray(), library.GetPeopleItems(new InternalPeopleQuery(["Artist", "AlbumArtist"], [])).Items.Select(x => new AliasRecord(x.Id, x.Name, new(x.ProviderIds))).ToArray());
    public LocalNameSuggestion[] LocalNames() => Members().SelectMany(x => x.Artists.Concat(x.AlbumArtists)).Distinct().Order().Select(name => new LocalNameSuggestion(name, "library", library.GetArtists([name]).Values.SelectMany(x => x).Select(x => new AliasCandidate(x.Id, x.Name)).ToArray(), library.GetPeopleItems(new InternalPeopleQuery(["Artist", "AlbumArtist"], []) { NameContains = name }).Items.Where(x => IdentityEngine.Key(x.Name) == IdentityEngine.Key(name)).Select(x => new AliasCandidate(x.Id, x.Name)).ToArray())).ToArray();
    public async Task<AliasSuggestionsResponse> Suggestions(string mbid, CancellationToken token)
    {
        if (!Guid.TryParse(mbid, out _))
            throw new ArgumentException("Use a confirmed MusicBrainz artist ID.");
        await suggestionGate.WaitAsync(token);
        try
        {
            if (suggestionCache.TryGetValue(mbid, out var cached) && clock.UtcNow - cached.Time < TimeSpan.FromHours(24))
                return cached.Data;
            var delay = lastSuggestionCall.AddSeconds(1.1) - clock.UtcNow;
            if (delay > TimeSpan.Zero)
                await Task.Delay(delay, token);
            lastSuggestionCall = clock.UtcNow;
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
            timeout.CancelAfter(TimeSpan.FromSeconds(15));
            var client = http.CreateClient();
            client.DefaultRequestHeaders.UserAgent.ParseAdd("MusicMetadataManager/0.2.0 (https://jellyfin.org; local artist alias editor)");
            using var response = await client.GetAsync("https://musicbrainz.org/ws/2/artist/" + mbid + "?inc=aliases&fmt=json", timeout.Token);
            response.EnsureSuccessStatusCode();
            using var result = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(timeout.Token), cancellationToken: timeout.Token);
            var data = new AliasSuggestionsResponse("MusicBrainz", mbid, result.RootElement.GetProperty("name").GetString(), true, result.RootElement.GetProperty("aliases").EnumerateArray().Select(x => new AliasSuggestion(x.GetProperty("name").GetString(), x.TryGetProperty("locale", out var l) ? l.GetString() : null, x.TryGetProperty("type", out var t) ? t.GetString() : null)).ToArray());
            suggestionCache[mbid] = (clock.UtcNow, data);
            return data;
        }
        finally
        {
            suggestionGate.Release();
        }
    }
}

public sealed class AliasSearch(AliasService aliases) : IInternalSearchProvider
{
    public string Name => "Music artist aliases";
    public MetadataPluginType Type => MetadataPluginType.SearchProvider;
    public int Priority => 90;

    public bool CanSearch(SearchProviderQuery q) => !string.IsNullOrWhiteSpace(q.SearchTerm);
    public Task<IReadOnlyList<SearchResult>> SearchAsync(SearchProviderQuery q, CancellationToken token)
    {
        var result = new List<SearchResult>();
        if (q.MediaTypes.Length > 0 && !q.MediaTypes.Contains(MediaType.Audio))
            return Task.FromResult<IReadOnlyList<SearchResult>>([]);
        foreach (var view in aliases.Views(aliases.User(q.UserId), q.ParentId))
        {
            var score = IdentityEngine.SearchScore(view.Identity, q.SearchTerm);
            if (score == 0)
                continue;
            bool Allow(BaseItemKind type) => (q.IncludeItemTypes.Length == 0 || q.IncludeItemTypes.Contains(type)) && !q.ExcludeItemTypes.Contains(type);
            if (Allow(BaseItemKind.MusicArtist))
                result.Add(new(view.Identity.ArtistId, score));
            if (Allow(BaseItemKind.Person))
                result.Add(new(view.Identity.PersonId, score));
            foreach (var item in view.Members)
                if (Allow(item.Album ? BaseItemKind.MusicAlbum : BaseItemKind.Audio))
                    result.Add(new(item.Id, score - 1));
        }

        return Task.FromResult<IReadOnlyList<SearchResult>>(result.DistinctBy(x => x.ItemId).ToArray());
    }
}
