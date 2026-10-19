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

public sealed class Record
{
    public Guid Id
    {
        get; set;
    }
    public string Path { get; set; } = ""; public Dictionary<string, JsonElement> Original { get; set; } = []; public Dictionary<string, JsonElement> Applied { get; set; } = []; public string[] RuleIds { get; set; } = [];
}
public sealed class Journal
{
    public Dictionary<string,string> IdentityNames {get;set;}=[];
    public Dictionary<Guid,ManagedRecord> Metadata {get;set;}=[];public List<HistoryEntry> History {get;set;}=[];public Dictionary<Guid,RestoreValues> Restores {get;set;}=[];public Dictionary<Guid,string> DeletedRecords {get;set;}=[];
    public List<ApplicationReport> Reports {get;set;}=[]; public int SchemaVersion { get; set; } = 3; public Dictionary<Guid, Record> Items { get; set; } = []; public List<Guid> RefreshPending { get; set; } = []; public List<string> AcknowledgedErrors {get;set;}=[]; public List<string> Errors { get; set; } = [];
}
public sealed class Change
{
    public MetadataPolicy[] MetadataEdits {get;set;}=[];public string[] ActivatePolicies {get;set;}=[];public string[] DisablePolicies {get;set;}=[];public string[] DeletePolicies {get;set;}=[];public Relinquish[] Relinquish {get;set;}=[];public Guid[] CleanupIds {get;set;}=[];
    public ArtistIdentity[] IdentityEdits { get; set; } = []; public string[] ActivateIdentities { get; set; } = []; public string[] DisableIdentities { get; set; } = []; public string[] DeleteIdentities { get; set; } = [];
    public Rule[] Edits { get; set; } = []; public string[] ActivateIds { get; set; } = []; public string[] DisableIds { get; set; } = []; public string[] DeleteIds { get; set; } = [];
}
public sealed class Activation
{
    public string Token { get; set; } = "";
}
public sealed class Row
{
    public Guid Id
    {
        get; set;
    }
    public string Path { get; set; } = ""; public string Kind { get; set; } = ""; public bool Locked
    {
        get; set;
    }
    public string[] RuleIds { get; set; } = []; public Dictionary<string, JsonElement> Before { get; set; } = []; public Dictionary<string, JsonElement> After { get; set; } = []; public string[] ChangedFields { get; set; } = []; public string[] ReleasedFields { get; set; } = [];
}
public sealed class Preview
{
    public string Token { get; set; } = ""; public long Revision
    {
        get; set;
    }
    public object[] Restoration {get;set;}=[];
    public object[] Metadata {get;set;}=[];public object[] Cleanup {get;set;}=[];
    public object[] Identities { get; set; } = []; public List<Row> Items { get; set; } = []; public string[] UnmatchedRules { get; set; } = []; public string[] Warnings { get; set; } = [];
}
sealed record Review(Change Change, string Fingerprint, DateTime Expires, Dictionary<Guid,string> CleanupHashes);
public sealed partial class Corrections(ILibraryManager library, IFileSystem fileSystem, ILogger<Corrections> logger,Inventory inventory,Sources sources,IProviderManager providers)
{
    readonly SemaphoreSlim gate = new(1, 1); Journal? journal; readonly Dictionary<string, Review> reviews = [];
    public Action<Guid, bool>? Enqueue
    {
        get; set;
    }
    public Func<int>? QueueCount
    {
        get; set;
    }
    string JournalPath => Path.Combine(Plugin.Instance.StatePath, "state.json");
    Journal State => journal ??= File.Exists(JournalPath) ? JsonSerializer.Deserialize<Journal>(File.ReadAllText(JournalPath), Codec.Json) ?? throw new InvalidDataException("Empty correction journal.") : new();
    void SaveState()
    {
        var path = JournalPath + ".tmp";
        File.WriteAllText(path, JsonSerializer.Serialize(State, Codec.Json));
        File.Move(path, JournalPath, true);
    }
    Document Doc => Plugin.Instance.Configuration.Rules;
    public object Libraries() => library.GetVirtualFolders().Where(x => x.CollectionType?.ToString().Equals("music", StringComparison.OrdinalIgnoreCase) == true).Select(x => new { id = x.ItemId, name = x.Name, paths = x.Locations }).ToArray();
    (string Id, string[] Paths) Scope(BaseItem item)
    {
        var folders = library.GetVirtualFolders().Where(x => x.CollectionType?.ToString().Equals("music", StringComparison.OrdinalIgnoreCase) == true).SelectMany(x => x.Locations.Select(p => (Id: x.ItemId, Path: p))).Where(x => item.Path == x.Path || item.Path?.StartsWith(x.Path.TrimEnd('/') + "/", StringComparison.Ordinal) == true).OrderByDescending(x => x.Path.Length).ToArray();
        return folders.Length == 0 ? ("", []) : (folders[0].Id, [folders[0].Path]);
    }
    public BaseItem[] Items() => library.GetItemList(new InternalItemsQuery { Recursive = true, IncludeItemTypes = [BaseItemKind.Audio, BaseItemKind.MusicAlbum] }).Where(x => Scope(x).Id != "").OrderBy(x => x is MusicAlbum ? 1 : 0).ThenBy(x => x.Path, StringComparer.Ordinal).ToArray();
    public View Describe(BaseItem item)
    {
        var scope = Scope(item);
        var values = new Fields { Title = item.Name, Artists = (item is Audio a ? a.Artists : ((MusicAlbum)item).Artists).ToArray(), AlbumArtists = (item is Audio b ? b.AlbumArtists : ((MusicAlbum)item).AlbumArtists).ToArray() };
        if (item is Audio t)
        {
            values.Album = t.Album;
            values.DiscNumber = t.ParentIndexNumber;
            values.TrackNumber = t.IndexNumber;
        }
        var result = NativeMetadata.Read(item);
        foreach (var field in new[] { "title", "album", "artists", "albumArtists", "discNumber", "trackNumber" })
            if (!result.ContainsKey(field))
                result[field] = JsonSerializer.SerializeToElement<object?>(null);
        return new()
        {
            Id = item.Id,
            Kind = item is Audio ? "track" : "album",
            Path = item.Path ?? "",
            Library = scope.Id,
            AlbumPath = item is Audio && library.GetItemById(item.ParentId) is MusicAlbum parent ? parent.Path ?? "" : "",
            LibraryPaths = scope.Paths,
            Locked = item.IsLocked,
            TitleLocked = item.LockedFields.Contains(MetadataField.Name),
            Values = result
        };
    }
    View Baseline(View actual, bool fresh = false)
    {
        var v = Codec.Clone(actual);
        if (State.Items.TryGetValue(v.Id, out var old))
            foreach (var p in old.Original)
                if (old.Applied.TryGetValue(p.Key, out var last) && actual.Values.TryGetValue(p.Key, out var current) && (!fresh || actual.Locked || actual.TitleLocked && p.Key == "title" || Engine.Equal(last, current)))
                    v.Values[p.Key] = p.Value;
        return v;
    }
    Plan Project(BaseItem item, View view, IEnumerable<Rule> rules, Dictionary<Guid, Plan>? plans = null)
    {
        var plan = Engine.Project(view, rules);
        if (item is MusicAlbum album && !plan.Values.ContainsKey("artists"))
        {
            var tracks = library.GetItemList(new InternalItemsQuery { ParentId = album.Id, Recursive = true, IncludeItemTypes = [BaseItemKind.Audio] }).OfType<Audio>().OrderBy(x => x.Path, StringComparer.Ordinal).ToArray();
            List<string> names = [];
            HashSet<string> ids = [];
            bool managed = false;
            foreach (var track in tracks)
            {
                var tv = Baseline(Describe(track));
                var tp = plans != null && plans.TryGetValue(track.Id, out var existing) ? existing : Engine.Project(tv, rules);
                var val = tp.Values.TryGetValue("artists", out var artists) ? artists : tv.Values["artists"];
                names.AddRange(val.Deserialize<string[]>() ?? []);
                if (tp.Values.ContainsKey("artists"))
                {
                    managed = true;
                    ids.UnionWith(tp.RuleIds);
                }
            }
            if (managed)
            {
                plan.Values["artists"] = JsonSerializer.SerializeToElement(names.Distinct(StringComparer.OrdinalIgnoreCase).ToArray());
                plan.RuleIds = plan.RuleIds.Concat(ids).Distinct().Order().ToArray();
            }
        }
        return plan;
    }
    void ValidateDocument(Document d)
    {
        if (d is null)
            throw new ArgumentException("Supply a rules document.");
        if (d.Active is null || d.Drafts is null || d.Identities is null || d.IdentityDrafts is null || d.Policies is null || d.PolicyDrafts is null)
            throw new ArgumentException("Active and draft rule lists must not be null.");
        if (d.SchemaVersion is not (1 or 2 or 3))
            throw new ArgumentException("Unsupported rules schema version.");
        if (d.Active.Concat(d.Drafts).Any(r => r is null || r.Fields is null || r.TrackDefaults is null || r.Libraries is null || r.Names is null))
            throw new ArgumentException("Rules and field lists must not be null.");
        if(d.Policies.Concat(d.PolicyDrafts).Any(p=>p is null||p.Fields is null||p.Libraries is null||p.Bindings is null||p.Snapshots is null||p.Images is null))throw new ArgumentException("Metadata policies and their lists must not be null.");
        var errors = Engine.Validate(d.Active);
        errors.AddRange(MetadataEngine.ValidatePolicies(d.Policies));
        foreach(var policy in d.PolicyDrafts)errors.AddRange(MetadataEngine.ValidatePolicies([policy]));
        if(d.PolicyDrafts.Select(x=>x.Id).Distinct().Count()!=d.PolicyDrafts.Count)errors.Add("Duplicate metadata draft IDs");
        if(d.Policies.Any(p=>p.IdentityId!=null&&!d.Identities.Any(i=>i.Id==p.IdentityId)))errors.Add("Stop managing canonical metadata before disabling or deleting its identity.");
        errors.AddRange(IdentityEngine.Validate(d.Identities));
        foreach(var identity in d.IdentityDrafts) errors.AddRange(IdentityEngine.Validate([identity]));
        if(d.IdentityDrafts.Select(x=>x.Id).Distinct().Count()!=d.IdentityDrafts.Count) errors.Add("Duplicate identity draft IDs.");
        foreach (var r in d.Drafts)
            errors.AddRange(Engine.Validate([r]));
        if (d.Drafts.Select(x => x.Id).Distinct().Count() != d.Drafts.Count)
            errors.Add("Duplicate draft IDs.");
        var libs = library.GetVirtualFolders().Where(x => x.CollectionType?.ToString().Equals("music", StringComparison.OrdinalIgnoreCase) == true).Select(x => x.ItemId).ToHashSet();
        if (d.Active.Concat(d.Drafts).Any(r => r?.Libraries is null || r.Libraries.Any(id => !libs.Contains(id))))
            errors.Add("Select existing music library IDs.");
        if(d.Policies.Concat(d.PolicyDrafts).Any(p=>p.Libraries.Any(id=>!libs.Contains(id))))errors.Add("Select existing music library IDs for metadata policies.");
        if (errors.Count > 0)
            throw new ArgumentException(string.Join("\n", errors.Distinct()));
    }
    public string[] Validation(Document d){try{ValidateDocument(d);return [];}catch(ArgumentException e){return e.Message.Split('\n');}}
    Document Candidate(Change c)
    {
        if (c.Edits is null || c.Edits.Any(r => r is null) || c.ActivateIds is null || c.DisableIds is null || c.DeleteIds is null)
            throw new ArgumentException("Rule ID lists must not be null.");
        var d = Codec.Clone(Doc);
        if(c.IdentityEdits is null || c.IdentityEdits.Any(x=>x is null) || c.ActivateIdentities is null || c.DisableIdentities is null || c.DeleteIdentities is null)
            throw new ArgumentException("Identity change lists must not be null.");
        var identityIds=c.IdentityEdits.Select(x=>x.Id).Concat(c.ActivateIdentities).Concat(c.DisableIdentities).Concat(c.DeleteIdentities).ToArray();
        if(identityIds.Distinct().Count()!=identityIds.Length) throw new ArgumentException("An identity cannot have multiple actions.");
        foreach(var identity in c.IdentityEdits.Concat(c.ActivateIdentities.Select(id=>d.IdentityDrafts.SingleOrDefault(x=>x.Id==id)??throw new ArgumentException("Identity draft not found: "+id))))
        {
            d.Identities.RemoveAll(x=>x.Id==identity.Id); d.Identities.Add(Codec.Clone(identity)); d.IdentityDrafts.RemoveAll(x=>x.Id==identity.Id);
        }
        foreach(var id in c.DisableIdentities)
        {
            var identity=d.Identities.SingleOrDefault(x=>x.Id==id)??throw new ArgumentException("Identity not found: "+id);
            if(!d.IdentityDrafts.Any(x=>x.Id==id)) d.IdentityDrafts.Add(Codec.Clone(identity));
            d.Identities.RemoveAll(x=>x.Id==id);
        }
        foreach(var id in c.DeleteIdentities)
        {
            if(!d.Identities.Concat(d.IdentityDrafts).Any(x=>x.Id==id)) throw new ArgumentException("Identity not found: "+id);
            d.Identities.RemoveAll(x=>x.Id==id);d.IdentityDrafts.RemoveAll(x=>x.Id==id);
        }
        var editedIds = c.Edits.Select(r => r.Id).ToArray();
        if (editedIds.Distinct().Count() != editedIds.Length || editedIds.Intersect(c.ActivateIds.Concat(c.DisableIds).Concat(c.DeleteIds)).Any())
            throw new ArgumentException("An edited rule cannot have another action in the same preview.");
        foreach (var rule in c.Edits)
        {
            d.Active.RemoveAll(x => x.Id == rule.Id);
            d.Active.Add(Codec.Clone(rule));
            d.Drafts.RemoveAll(x => x.Id == rule.Id);
        }
        if (c.ActivateIds.Intersect(c.DisableIds.Concat(c.DeleteIds)).Any())
            throw new ArgumentException("A rule cannot be activated and removed together.");
        foreach (var id in c.ActivateIds)
        {
            var r = d.Drafts.SingleOrDefault(x => x.Id == id) ?? throw new ArgumentException("Draft not found: " + id);
            d.Active.RemoveAll(x => x.Id == id);
            d.Active.Add(Codec.Clone(r));
            d.Drafts.RemoveAll(x => x.Id == id);
        }
        foreach (var id in c.DisableIds)
        {
            var r = d.Active.SingleOrDefault(x => x.Id == id) ?? throw new ArgumentException("Active rule not found: " + id);
            if (!d.Drafts.Any(x => x.Id == id))
                d.Drafts.Add(Codec.Clone(r));
            d.Active.RemoveAll(x => x.Id == id);
        }
        foreach (var id in c.DeleteIds)
        {
            if (!d.Active.Concat(d.Drafts).Any(x => x.Id == id))
                throw new ArgumentException("Rule not found: " + id);
            d.Active.RemoveAll(x => x.Id == id);
            d.Drafts.RemoveAll(x => x.Id == id);
        }
        CandidateMetadata(d,c);
        ValidateDocument(d);
        return d;
    }
    Preview MakePreview(Document d)
    {
        List<Row> rows = [];
        HashSet<string> matched = [];
        Dictionary<Guid, Plan> plans = [];
        foreach (var item in Items())
        {
            var actual = Describe(item);
            var baseline = Baseline(actual);
            var plan = Project(item, baseline, d.Active, plans);
            plans[item.Id] = plan;
            matched.UnionWith(plan.RuleIds);
            State.Items.TryGetValue(item.Id, out var old);
            var released = old?.Applied.Keys.Except(plan.Values.Keys).ToArray() ?? [];
            if (plan.Values.Count == 0 && released.Length == 0)
                continue;
            var before = new Dictionary<string, JsonElement>();
            var after = new Dictionary<string, JsonElement>();
            foreach (var key in plan.Values.Keys.Concat(released).Distinct())
            {
                before[key] = actual.Values[key];
                after[key] = plan.Values.TryGetValue(key, out var target) ? target : old!.Original[key];
            }
            rows.Add(new()
            {
                Id = item.Id,
                Path = actual.Path,
                Kind = actual.Kind,
                Locked = actual.Locked || actual.TitleLocked && after.ContainsKey("title"),
                RuleIds = plan.RuleIds,
                Before = before,
                After = after,
                ChangedFields = after.Where(x => !Engine.Equal(before[x.Key], x.Value)).Select(x => x.Key).ToArray(),
                ReleasedFields = released
            });
        }
        return new()
        {
            Revision = Doc.Revision,
            Identities = AliasService.Reports(library, d.Identities),
            Metadata = MetadataPreview(d),
            Items = rows,
            UnmatchedRules = d.Active.Where(x => !matched.Contains(x.Id)).Select(x => x.Id).ToArray(),
            Warnings = (rows.Any(x=>x.ReleasedFields.Length>0)?new[]{"Removing managed fields refreshes affected items through Jellyfin providers. Preview shows recorded prior values; current provider results may differ. Locked fields use recorded values."}:Array.Empty<string>()).Concat(rows.Any(x=>x.ChangedFields.Any(f=>f is "title" or "album" or "artists" or "albumArtists" or "providerIds"))?new[]{"Changes to release titles, credits or provider IDs may alter scrobbling payloads. Review them explicitly."}:Array.Empty<string>()).ToArray()
        };
    }
    public async Task<Document> Export(CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var exported=Codec.Clone(Doc);exported.SchemaVersion=3;return exported;
        }
        finally { gate.Release(); }
    }
    public async Task SaveDraft(Rule rule, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var d = Codec.Clone(Doc);
            d.Drafts.RemoveAll(x => x.Id == rule.Id);
            d.Drafts.Add(Codec.Clone(rule));
            ValidateDocument(d);
            d.Revision++;
            Persist(d);
        }
        finally { gate.Release(); }
    }
    public async Task DeleteDraft(string id, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var d = Codec.Clone(Doc);
            if (d.Drafts.RemoveAll(x => x.Id == id) == 0)
                throw new ArgumentException("Draft not found: " + id);
            // A draft may share its ID with an active rule; remove only the draft revision.
            d.Revision++;
            Persist(d);
        }
        finally { gate.Release(); }
    }
    public async Task SaveIdentityDraft(ArtistIdentity identity, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try { var d=Codec.Clone(Doc);d.IdentityDrafts.RemoveAll(x=>x.Id==identity.Id);d.IdentityDrafts.Add(Codec.Clone(identity));ValidateDocument(d);d.Revision++;Persist(d); }
        finally { gate.Release(); }
    }
    public async Task DeleteIdentityDraft(string id, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try { var d=Codec.Clone(Doc);if(d.IdentityDrafts.RemoveAll(x=>x.Id==id)==0)throw new ArgumentException("Identity draft not found: "+id);d.Revision++;Persist(d); }
        finally { gate.Release(); }
    }
    public async Task Import(Document input, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            if (input.Active is null || input.Drafts is null || input.Identities is null || input.IdentityDrafts is null)
                throw new ArgumentException("Rule lists must not be null.");
            if (input.SchemaVersion is not (1 or 2 or 3))
                throw new ArgumentException("Unsupported rules schema version.");
            var d = Codec.Clone(Doc);
            var all = input.Active.Concat(input.Drafts).GroupBy(x => x.Id).Select(g => g.Last()).ToArray();
            foreach (var r in all)
            {
                d.Drafts.RemoveAll(x => x.Id == r.Id);
                d.Drafts.Add(Codec.Clone(r));
            }
            foreach(var policy in input.Policies.Concat(input.PolicyDrafts).GroupBy(x=>x.Id).Select(g=>g.Last())){d.PolicyDrafts.RemoveAll(x=>x.Id==policy.Id);d.PolicyDrafts.Add(Codec.Clone(policy));}
            foreach(var identity in input.Identities.Concat(input.IdentityDrafts).GroupBy(x=>x.Id).Select(g=>g.Last()))
            { d.IdentityDrafts.RemoveAll(x=>x.Id==identity.Id);d.IdentityDrafts.Add(Codec.Clone(identity)); }
            ValidateDocument(d);
            d.Revision++;
            Persist(d);
        }
        finally { gate.Release(); }
    }
    void Persist(Document d)
    {
        var previous = Doc;
        d.SchemaVersion = 3;
        Plugin.Instance.Configuration.Rules = d;
        try
        {
            Plugin.Instance.SaveConfiguration();
        }
        catch { Plugin.Instance.Configuration.Rules = previous; throw; }
        reviews.Clear();
    }
    public async Task<Preview> Preview(Change c, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var d = Candidate(c);
            foreach(var identity in d.Identities.Where(x=>!Doc.Identities.Any(old=>Codec.Hash(old)==Codec.Hash(x))))
                AliasService.ValidateBindings(library,identity);
            ValidateMetadata(d);
            var p = MakePreview(d);
            p.Cleanup=CleanupPreview(c.CleanupIds,d);p.Restoration=RelinquishPreview(c,d);
            var cleanup=p.Cleanup;
            p.Cleanup=[];
            var fingerprint = Codec.Hash(new
            {
                document = d,
                preview = p
            });
            p.Cleanup=cleanup;
            p.Token = Guid.NewGuid().ToString("N");
            foreach (var expired in reviews.Where(x => x.Value.Expires < DateTime.UtcNow).Select(x => x.Key).ToArray())
                reviews.Remove(expired);
            reviews[p.Token] = new(Codec.Clone(c), fingerprint, DateTime.UtcNow.AddMinutes(15),c.CleanupIds.Zip(cleanup).ToDictionary(pair=>pair.First,pair=>CleanupFingerprint(inventory.Item(pair.First),pair.Second)));
            return p;
        }
        finally { gate.Release(); }
    }
    public async Task<object> Activate(string token, CancellationToken cancellation)
    {
        await gate.WaitAsync(cancellation);
        try
        {
            if (!reviews.TryGetValue(token, out var review) || review.Expires < DateTime.UtcNow)
                throw new InvalidOperationException("Preview expired. Preview again.");
            Document d;Preview p;
            try{d=Candidate(review.Change);ValidateMetadata(d);p=MakePreview(d);p.Restoration=RelinquishPreview(review.Change,d);}
            catch(ArgumentException e){throw new InvalidOperationException("Reviewed metadata or dependencies changed. Preview again. "+e.Message,e);}
            if (Codec.Hash(new
            {
                document = d,
                preview = p
            }) != review.Fingerprint)
                throw new InvalidOperationException("Rules or affected metadata changed. Preview again.");
            var ids = Codec.Hash(d.Active)==Codec.Hash(Doc.Active) ? [] : p.Items.Select(x => x.Id).ToArray();
            // New rules can be applied directly. Refresh only items managed by a
            // changed or removed active rule, preserving unrelated provider metadata.
            var changedRules = Doc.Active.Where(old => !d.Active.Any(next => next.Id == old.Id && Codec.Hash(next) == Codec.Hash(old))).Select(x => x.Id).ToHashSet();
            var refreshIds = ids.Where(id => !review.Change.Relinquish.Any(r=>r.ItemId==id) && State.Items.TryGetValue(id, out var prior) && prior.RuleIds.Any(changedRules.Contains)).ToHashSet();
            var previousState=Codec.Clone(State);Guid[] managerIds;
            try{
                State.RefreshPending = State.RefreshPending.Concat(refreshIds).Distinct().ToList();
                managerIds=CommitMetadata(d,review.Change);
                d.Revision++;
                Persist(d);
            }catch{journal=previousState;SaveState();throw;}
            var cleanupResults = DeleteOrphans(review.Change.CleanupIds,d,review.CleanupHashes);
            foreach(var managerId in managerIds)Enqueue?.Invoke(managerId,false);
            foreach (var id in ids)
                Enqueue?.Invoke(id, refreshIds.Contains(id));
            return new
            {
                cleanupResults,
                revision = d.Revision,
                queued = ids.Concat(managerIds).Distinct().Count()
            };
        }
        finally { gate.Release(); }
    }
    public async Task<object> ApplyAll(CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var p = MakePreview(Doc);
            foreach (var row in p.Items)
                Enqueue?.Invoke(row.Id, false);
            foreach(var id in ManagedTargets(Doc).Concat(State.Restores.Keys).Distinct())Enqueue?.Invoke(id,false);
            return new
            {
                queued = p.Items.Select(x=>x.Id).Concat(ManagedTargets(Doc)).Concat(State.Restores.Keys).Distinct().Count()
            };
        }
        finally { gate.Release(); }
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
                identities = Doc.Identities.Count, identityDrafts = Doc.IdentityDrafts.Count, identityStatus = AliasService.Reports(library,Doc.Identities),
                managedItems = State.Items.Count,
                metadataPolicies=Doc.Policies.Count,policyDrafts=Doc.PolicyDrafts.Count,managedRecords=State.Metadata.Count,history=State.History.TakeLast(100).ToArray(),recreatedRecords=State.DeletedRecords.Where(x=>library.GetItemById(x.Key)!=null).ToArray(),
                pending = QueueCount?.Invoke() ?? 0,
                refreshPending = State.RefreshPending.Count,
                errors = State.Reports.Where(r=>r.ArchivedAt==null).Select(r=>r.Message).ToArray(),
                reports = State.Reports.Where(r=>r.ArchivedAt==null).ToArray(),
                unmatchedRules = p.UnmatchedRules
            };
        }
        finally { gate.Release(); }
    }
    public async Task<Guid[]> Recovery(CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            InitializeReports();
            inventory.RecoverMembership(State);
            ValidateDocument(Doc);
            return State.RefreshPending.ToArray();
        }
        finally { gate.Release(); }
    }
    public async Task Error(Guid id, Exception e)
    {
        await gate.WaitAsync();
        try
        {
            var message = $"{DateTime.UtcNow:O} {id}: {e.Message}";
            logger.LogError(e, "Metadata correction failed for {ItemId}", id);
            AddReport(message,id);
            try
            {
                SaveState();
            }
            catch (Exception storageError) { logger.LogError(storageError, "Unable to persist correction error; state storage is unavailable."); }
        }
        finally { gate.Release(); }
    }
    public async Task Missing(Guid id, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            if (State.RefreshPending.Remove(id))
            {
                AddReport($"{id}: item no longer exists; pending refresh cancelled.",id);
                SaveState();
            }
        }
        finally { gate.Release(); }
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
            if(item is MusicArtist or MediaBrowser.Controller.Entities.Person)return await CorrectMetadata(item,persist,token);
            if (item is not Audio && item is not MusicAlbum)
                return ItemUpdateType.None;
            var actual = Describe(item);
            if (actual.Library == "")
                return ItemUpdateType.None;
            var baseline = Baseline(actual, !persist);
            var plan = Project(item, baseline, Doc.Active);
            State.Items.TryGetValue(item.Id, out var old);
            var record = new Record { Id = item.Id, Path = actual.Path, RuleIds = plan.RuleIds };
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
            await CorrectMetadata(item,persist,token);
            if (changed.Count > 0)
                logger.LogInformation("Corrected {Path}: {Fields}", item.Path, string.Join(", ", changed.Keys));
            return changed.Count > 0 ? ItemUpdateType.MetadataEdit : ItemUpdateType.None;
        }
        finally { gate.Release(); }
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
            default:NativeMetadata.Write(item,field,value);break;
        }
    }
}
