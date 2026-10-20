using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Providers;
using MediaBrowser.Controller.Dto;
using Jellyfin.Data.Enums;
using Microsoft.Extensions.Logging;

namespace MusicMetadataManager;
public sealed class InventoryQueries(ILibraryManager library, IMusicInventory inventory, Sources sources, StateCoordinator state, MetadataPolicies policyService)
{
    SemaphoreSlim gate => state.Gate;

    Journal State => state.Journal;

    Document Doc => state.Document;

    bool IsManaged(Guid id) => State.Records.TryGetValue(id, out var record) && (record.Applied.Count > 0 || record.AppliedImages.Count > 0);
    public async Task<InventoryPage> ManagerInventory(string? search, string? libraryId, string? kind, int start, int limit, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            if (start < 0 || limit < 1 || limit > 200)
                throw new ArgumentException("Use a nonnegative start and limit 1–200");
            var records = inventory.Records().Where(x => kind is null || x.GetType().Name == kind || kind == "artist" && x is MusicArtist or Person || kind == "track" && x is Audio || kind == "album" && x is MusicAlbum).Where(x => search is null || x.Name.Contains(search, StringComparison.OrdinalIgnoreCase) || (x.Path ?? "").Contains(search, StringComparison.OrdinalIgnoreCase)).OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Id).ToArray();
            // Scope artist records by actual uses, retain true orphans when browsing all music.
            var list = records.Select(x => new { item = x, scope = inventory.Scope(x) }).Where(x => libraryId is null || x.scope.Id == libraryId || x.item is MusicArtist or Person && inventory.Inspect(x.item, [libraryId]).Music.Any(u => u.Library == libraryId)).ToArray();
            return new InventoryPage(list.Length, start, limit, list.Skip(start).Take(limit).Select(x => new InventoryEntry(x.item.Id, x.item.Name, x.item.GetType().Name, x.item.Path, x.scope.Id, IsManaged(x.item.Id), null, [], [], false, Doc.Identities.Where(i => i.Records.Contains(x.item.Id)).Select(i => new IdentityMembership(i.Id, i.PreferredName, i.ArtistId == x.item.Id || i.PersonId == x.item.Id)).ToArray())).ToArray(), "native", Doc.Identities.Select(x => new CanonicalIdentityInfo(x.Id, x.PreferredName, x.Aliases, x.Records, x.Libraries)).ToArray());
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<ManagerDetailsResponse> ManagerDetails(Guid id, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var item = inventory.Item(id);
            var policies = policyService.AllPolicies(Doc).Where(x => inventory.Targets(x, Doc).Contains(id)).ToArray();
            var identity = Doc.Identities.SingleOrDefault(x => x.Records.Contains(id));
            var scope = inventory.Scope(item);
            var libs = scope.Id != "" ? new[]
            {
                scope.Id
            }

            : inventory.Inspect(item, []).Music.Select(x => x.Library).Distinct().ToArray();
            var rule = Doc.Active.FirstOrDefault(x => x.Path == item.Path && x.Kind == (item is Audio ? "track" : "album"));
            var edit = policies.FirstOrDefault(x => x.IdentityId == identity?.Id) ?? policies.FirstOrDefault() ?? (rule != null ? policyService.ToPolicy(rule) : new MetadataPolicy
            {
                ItemId = identity is null ? id : Guid.Empty,
                IdentityId = identity?.Id,
                Libraries = identity?.Libraries ?? libs,
                Label = identity?.PreferredName ?? item.Name
            }

            );
            if (item is Audio or MusicAlbum && rule != null)
                edit = policyService.ToPolicy(rule);
            return new ManagerDetailsResponse(id, item.Name, item.GetType().Name, item.Path, NativeMetadata.Read(item), NativeMetadata.Read(item).ToDictionary(x => x.Key, x => x.Key == "title" && identity != null ? JsonSerializer.SerializeToElement(identity.PreferredName) : x.Value), edit, policies, Doc.PolicyDrafts.Where(x => x.ItemId == id || x.IdentityId == identity?.Id).Concat(Doc.Drafts.Where(x => x.Metadata?.ItemId == id).Select(policyService.ToPolicy)).ToArray(), inventory.Inspect(item, libs), item.ProviderIds.Select(x => new ProviderCandidate(x.Key, x.Value, policies.Any(p => p.Bindings.Any(b => b.Key == x.Key && b.RecordId == x.Value)))).ToArray(), sources.Providers(item), item.LockedFields.Select(x => x.ToString()).ToArray(), item.IsLocked, State.Records.GetValueOrDefault(id), State.Records.GetValueOrDefault(id), item.ImageInfos.Select(x => new NativeImageInfo(x.Type.ToString(), x.Path)).ToArray(), State.History.Where(x => x.ItemId == id).ToArray(), "Only approved fields/images are reasserted after refresh; unmanaged fields follow Jellyfin. Stored IDs and NFO files do not establish historical field provenance.");
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<NavigationResponse> NativeNavigation(string? ids, string? rules, string? paths, CancellationToken token)
    {
        var requestedIds = (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries);
        var requestedRules = (rules ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries);
        if (requestedIds.Length > 100 || requestedRules.Length > 100)
            throw new ArgumentException("Request at most 100 item and rule destinations");
        if (requestedIds.Any(x => !Guid.TryParse(x, out _)))
            throw new ArgumentException("Invalid native item ID");
        NavigationPath[] requestedPaths;
        try
        {
            requestedPaths = string.IsNullOrEmpty(paths) ? [] : JsonSerializer.Deserialize<NavigationPath[]>(paths, Codec.Json) ?? [];
        }
        catch (JsonException)
        {
            throw new ArgumentException("Invalid path destinations");
        }

        if (requestedPaths.Length > 20 || requestedPaths.Any(x => x is null || x.Kind is not ("track" or "album") || string.IsNullOrEmpty(x.Path) || !x.Path.StartsWith('/') || x.Key != x.Kind + ":" + x.Path))
            throw new ArgumentException("Invalid path destinations");
        await gate.WaitAsync(token);
        try
        {
            var items = requestedIds.Distinct().ToDictionary(x => x, x => library.GetItemById(Guid.Parse(x))is { } item ? new NavigationDestination(item.Id, item.Name) : null);
            var targets = new Dictionary<string, NavigationDestination?>();
            var definitions = Doc.Active.Concat(Doc.Drafts).ToArray();
            var records = requestedRules.Length > 0 || requestedPaths.Length > 0 ? inventory.Records() : [];
            foreach (var key in requestedRules.Distinct())
            {
                var rule = definitions.FirstOrDefault(x => x.Id == key);
                var matches = rule is null || rule.Kind == "alias" ? [] : records.Where(x => x.Path == rule.Path && (rule.Kind == "album" ? x is MusicAlbum : x is Audio)).ToArray();
                targets[key] = matches.Length == 1 ? new NavigationDestination(matches[0].Id, matches[0].Name) : null;
            }

            var pathTargets = new Dictionary<string, NavigationDestination?>();
            foreach (var target in requestedPaths)
            {
                var matches = records.Where(x => x.Path == target.Path && (target.Kind == "album" ? x is MusicAlbum : x is Audio)).ToArray();
                pathTargets[target.Key] = matches.Length == 1 ? new NavigationDestination(matches[0].Id, matches[0].Name) : null;
            }

            return new NavigationResponse(items, targets, pathTargets);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<InventoryPage> GroupedInventory(string? search, string? libraryId, string? kind, int start, int limit, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            if (start < 0 || limit < 1 || limit > 200)
                throw new ArgumentException("Use a nonnegative start and limit 1–200");
            var records = inventory.Records();
            var byId = records.ToDictionary(x => x.Id);
            var rows = new List<InventoryEntry>();
            var grouped = new HashSet<Guid>();
            bool Matches(IEnumerable<string?> names) => string.IsNullOrWhiteSpace(search) || names.Any(n => n != null && IdentityEngine.Key(n).Contains(IdentityEngine.Key(search), StringComparison.Ordinal));
            if (kind is null or "" or "artist" or "identity")
                foreach (var identity in Doc.Identities.Where(i => libraryId is null || i.Libraries.Contains(libraryId)))
                {
                    var links = identity.Records.Where(byId.ContainsKey).Select(id => byId[id]).ToArray();
                    foreach (var id in identity.Records)
                        grouped.Add(id);
                    if (!Matches(identity.Names.Concat(links.SelectMany(x => new[] { x.Name, x.Path }))))
                        continue;
                    rows.Add(new(identity.ArtistId, identity.PreferredName, "identity", null, "", links.Any(x => IsManaged(x.Id)), identity.Id, identity.Aliases, links.Select(x => new InventoryRecord(x.Id, x.Name, x.GetType().Name, x.Path, x.Id == identity.ArtistId || x.Id == identity.PersonId)).ToArray(), !byId.ContainsKey(identity.ArtistId) || !byId.ContainsKey(identity.PersonId)));
                }

            foreach (var item in records)
            {
                if (grouped.Contains(item.Id) || kind == "identity")
                    continue;
                var itemKind = item is Audio ? "track" : item is MusicAlbum ? "album" : item.GetType().Name;
                if (!string.IsNullOrEmpty(kind) && kind != itemKind && !(kind == "artist" && itemKind is "MusicArtist" or "Person"))
                    continue;
                var scope = inventory.Scope(item);
                if (libraryId != null && scope.Id != libraryId && !(itemKind is "MusicArtist" or "Person" && inventory.Inspect(item, [libraryId]).Music.Any(x => x.Library == libraryId)))
                    continue;
                if (!Matches([item.Name, item.Path]))
                    continue;
                rows.Add(new(item.Id, item.Name, itemKind, item.Path, scope.Id, IsManaged(item.Id), null, [], [], false));
            }

            var sorted = rows.OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Kind, StringComparer.Ordinal).ThenBy(x => x.Id).ToArray();
            return new InventoryPage(sorted.Length, start, limit, sorted.Skip(start).Take(limit).ToArray(), "grouped");
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<AlbumTracksResponse> AlbumTracks(Guid id, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            if (inventory.Item(id)is not MusicAlbum album)
                throw new ArgumentException("Select an album to list its tracks");
            var rows = inventory.Records().OfType<Audio>().Where(x => x.ParentId == album.Id).OrderBy(x => x.ParentIndexNumber ?? 1).ThenBy(x => x.IndexNumber ?? int.MaxValue).ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Id).Select(x => new TrackSummary(x.Id, x.Name, x.ParentIndexNumber, x.IndexNumber, x.Artists.ToArray(), x.Path, IsManaged(x.Id))).ToArray();
            return new AlbumTracksResponse(id, rows.Length, rows);
        }
        finally
        {
            gate.Release();
        }
    }
}
