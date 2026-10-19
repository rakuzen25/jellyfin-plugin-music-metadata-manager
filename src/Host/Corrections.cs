using System.Text.Json;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Providers;
using Jellyfin.Data.Enums;
using Microsoft.Extensions.Logging;

namespace MusicMetadataManager;
sealed record Review(Change Change, string Fingerprint, DateTime Expires, Dictionary<Guid, string> CleanupHashes);
public sealed partial class Corrections(ILibraryManager library, IFileSystem fileSystem, ILogger<Corrections> logger, Inventory inventory, Sources sources, IProviderManager providers, IConfigurationStore configuration, IJournalStore journalStore, IClock clock, IRefreshQueue refreshQueue, IPluginStorage storage)
{
    readonly SemaphoreSlim gate = new(1, 1);
    Journal? journal;
    readonly Dictionary<string, Review> reviews = [];
    Journal State => journal ??= journalStore.Load();

    void SaveState() => journalStore.Save(State);
    Document Doc => configuration.Current;

    public object Libraries() => library.GetVirtualFolders().Where(x => x.CollectionType?.ToString().Equals("music", StringComparison.OrdinalIgnoreCase) == true).Select(x => new { id = x.ItemId, name = x.Name, paths = x.Locations }).ToArray();
    public async Task<object> ApplyAll(CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var p = MakePreview(Doc);
            foreach (var row in p.Items)
                refreshQueue.Enqueue(row.Id, false);
            foreach (var id in ManagedTargets(Doc).Concat(State.Restores.Keys).Distinct())
                refreshQueue.Enqueue(id, false);
            return new
            {
                queued = p.Items.Select(x => x.Id).Concat(ManagedTargets(Doc)).Concat(State.Restores.Keys).Distinct().Count()
            };
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<object> Status(CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var p = MakePreview(Doc);
            return new
            {
                revision = Doc.Revision,
                active = Doc.Active.Count,
                drafts = Doc.Drafts.Count,
                identities = Doc.Identities.Count,
                identityDrafts = Doc.IdentityDrafts.Count,
                identityStatus = AliasService.Reports(library, Doc.Identities),
                managedItems = State.Items.Count,
                metadataPolicies = Doc.Policies.Count,
                policyDrafts = Doc.PolicyDrafts.Count,
                managedRecords = State.Metadata.Count,
                history = State.History.TakeLast(100).ToArray(),
                recreatedRecords = State.DeletedRecords.Where(x => library.GetItemById(x.Key) != null).ToArray(),
                pending = refreshQueue.Count(),
                refreshPending = State.RefreshPending.Count,
                reports = State.Reports.Where(r => r.ArchivedAt == null).ToArray(),
                unmatchedRules = p.UnmatchedRules
            };
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<Guid[]> Recovery(CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            inventory.RecoverMembership(State);
            ValidateDocument(Doc);
            return State.RefreshPending.ToArray();
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task Error(Guid id, Exception e)
    {
        await gate.WaitAsync();
        try
        {
            var message = $"{clock.UtcNow:O} {id}: {e.Message}";
            logger.LogError(e, "Metadata correction failed for {ItemId}", id);
            AddReport(message, id);
            try
            {
                SaveState();
            }
            catch (Exception storageError)
            {
                logger.LogError(storageError, "Unable to persist correction error; state storage is unavailable.");
            }
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task Missing(Guid id, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            if (State.RefreshPending.Remove(id))
            {
                AddReport($"{id}: item no longer exists; pending refresh cancelled.", id);
                SaveState();
            }
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task Refresh(Guid id, CancellationToken token)
    {
        var item = library.GetItemById(id);
        if (item is not Audio && item is not MusicAlbum)
            return;
        await item.RefreshMetadata(new MetadataRefreshOptions(new DirectoryService(fileSystem)) { MetadataRefreshMode = MetadataRefreshMode.FullRefresh, ReplaceAllMetadata = true, ImageRefreshMode = MetadataRefreshMode.ValidationOnly, ForceSave = true }, token);
    }

    public async Task<ItemUpdateType> Correct(BaseItem incoming, bool persist, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var item = persist ? library.RetrieveItem(incoming.Id) : incoming;
            if (item is MusicArtist or MediaBrowser.Controller.Entities.Person)
                return await CorrectMetadata(item, persist, token);
            if (item is not Audio && item is not MusicAlbum)
                return ItemUpdateType.None;
            var actual = Describe(item);
            if (actual.Library == "")
                return ItemUpdateType.None;
            var baseline = Baseline(actual, !persist);
            var plan = Project(item, baseline, Doc.Active);
            State.Items.TryGetValue(item.Id, out var old);
            var record = new Record
            {
                Id = item.Id,
                Path = actual.Path,
                RuleIds = plan.RuleIds
            };
            if (!persist && plan.Values.Count == 0)
                return ItemUpdateType.None;
            var targets = new Dictionary<string, JsonElement>(plan.Values);
            if (persist && old != null)
                foreach (var p in old.Applied)
                    if (!plan.Values.ContainsKey(p.Key))
                        targets[p.Key] = Engine.Equal(actual.Values[p.Key], p.Value) || actual.Locked || actual.TitleLocked && p.Key == "title" ? old.Original[p.Key] : actual.Values[p.Key];
            foreach (var p in plan.Values)
            {
                record.Original[p.Key] = baseline.Values[p.Key];
                record.Applied[p.Key] = p.Value;
            }

            if (!persist && old != null)
                foreach (var p in old.Applied)
                    if (!record.Applied.ContainsKey(p.Key))
                    {
                        record.Original[p.Key] = old.Original[p.Key];
                        record.Applied[p.Key] = p.Value;
                    }

            var changed = targets.Where(p => !Engine.Equal(actual.Values[p.Key], p.Value)).ToDictionary();
            bool changedPeople = changed.ContainsKey("artists") || changed.ContainsKey("albumArtists");
            // Persist the restoration baseline before any metadata write. Keep released fields
            // until reconciliation has successfully saved the item, so a crash is recoverable.
            if (changed.Count > 0)
            {
                var durable = Codec.Clone(record);
                if (old != null)
                    foreach (var p in old.Applied)
                        if (!durable.Applied.ContainsKey(p.Key))
                        {
                            durable.Original[p.Key] = old.Original[p.Key];
                            durable.Applied[p.Key] = p.Value;
                        }

                if (durable.Applied.Count > 0)
                    State.Items[item.Id] = durable;
                SaveState();
            }

            foreach (var p in changed)
                Set(item, p.Key, p.Value);
            if (plan.Values.ContainsKey("artists") || plan.Values.ContainsKey("albumArtists"))
                foreach (var name in (item is Audio namedTrack ? namedTrack.Artists.Concat(namedTrack.AlbumArtists) : ((MusicAlbum)item).Artists.Concat(((MusicAlbum)item).AlbumArtists)).Distinct(StringComparer.OrdinalIgnoreCase))
                    library.GetArtist(name);
            if (changedPeople)
            {
                var artists = item is Audio a ? a.Artists : ((MusicAlbum)item).Artists;
                var albums = item is Audio b ? b.AlbumArtists : ((MusicAlbum)item).AlbumArtists;
                var people = library.GetPeople(item).Where(x => x.Type != PersonKind.Artist && x.Type != PersonKind.AlbumArtist).ToList();
                people.AddRange(artists.Select(x => new PersonInfo { Name = x, Type = PersonKind.Artist }));
                people.AddRange(albums.Select(x => new PersonInfo { Name = x, Type = PersonKind.AlbumArtist }));
                await library.UpdatePeopleAsync(item, people, token);
            }

            if (changed.Count > 0 && persist)
                await library.UpdateItemAsync(item, library.GetItemById(item.ParentId)!, ItemUpdateType.MetadataEdit, token);
            if (record.Applied.Count > 0)
                State.Items[item.Id] = record;
            else
                State.Items.Remove(item.Id);
            if (persist)
                State.RefreshPending.Remove(item.Id);
            if (record.Applied.Count > 0 || old != null || State.RefreshPending.Contains(item.Id))
                SaveState();
            await CorrectMetadata(item, persist, token);
            if (changed.Count > 0)
                logger.LogInformation("Corrected {Path}: {Fields}", item.Path, string.Join(", ", changed.Keys));
            return changed.Count > 0 ? ItemUpdateType.MetadataEdit : ItemUpdateType.None;
        }
        finally
        {
            gate.Release();
        }
    }

    static void Set(BaseItem item, string field, JsonElement value)
    {
        switch (field)
        {
            case "title":
                item.Name = value.Deserialize<string>()!;
                break;
            case "album":
                ((Audio)item).Album = value.Deserialize<string>();
                break;
            case "discNumber":
                item.ParentIndexNumber = value.Deserialize<int?>();
                break;
            case "trackNumber":
                item.IndexNumber = value.Deserialize<int?>();
                break;
            case "artists":
                if (item is Audio a)
                    a.Artists = value.Deserialize<string[]>() ?? [];
                else
                    ((MusicAlbum)item).Artists = value.Deserialize<string[]>() ?? [];
                break;
            case "albumArtists":
                if (item is Audio b)
                    b.AlbumArtists = value.Deserialize<string[]>() ?? [];
                else
                    ((MusicAlbum)item).AlbumArtists = value.Deserialize<string[]>() ?? [];
                break;
            default:
                NativeMetadata.Write(item, field, value);
                break;
        }
    }
}
