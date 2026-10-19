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
public sealed class MetadataPolicies(ILibraryManager library, IMusicInventory inventory, Sources sources, StateCoordinator state, RuleProjection projection) : IMetadataPolicyEditor
{
    SemaphoreSlim gate => state.Gate;

    Journal State => state.Journal;

    Document Doc => state.Document;

    void SaveState() => state.Commit();
    public IEnumerable<MetadataPolicy> AllPolicies(Document d) => d.Policies.Concat(d.Active.Where(x => x.Metadata != null).Select(ToPolicy));
    public Guid[] ManagedTargets(Document d) => AllPolicies(d).SelectMany(p => p.IdentityId is null ? new[] { p.ItemId } : d.Identities.Where(i => i.Id == p.IdentityId).SelectMany(i => new[] { i.ArtistId, i.PersonId })).Distinct().ToArray();
    public MetadataPolicy ToPolicy(Rule rule)
    {
        var p = Codec.Clone(rule.Metadata ?? new MetadataPolicy { Id = rule.Id, ItemId = projection.Items().First(x => x.Path == rule.Path).Id, Libraries = rule.Libraries, Label = rule.Label });
        p.Fields = new(rule.Fields.Decisions);
        return p;
    }

    public void PutPolicy(Document d, MetadataPolicy policy, bool draft = false)
    {
        ArgumentNullException.ThrowIfNull(policy);
        if (policy.Fields is null || policy.Images is null || policy.Libraries is null || policy.Bindings is null || policy.Snapshots is null || policy.Fields.Values.Any(x => x is null) || policy.Images.Values.Any(x => x is null) || policy.Bindings.Any(x => x is null) || policy.Snapshots.Any(x => x is null))
            throw new ArgumentException("Metadata policy entries and collections must not be null.");
        if (policy.ItemId != Guid.Empty && library.GetItemById(policy.ItemId)is BaseItem item && (item is Audio or MusicAlbum))
        {
            var kind = item is Audio ? "track" : "album";
            var target = (draft ? d.Drafts : d.Active);
            var rule = target.FirstOrDefault(x => x.Id == policy.Id) ?? d.Active.FirstOrDefault(x => x.Kind == kind && x.Path == item.Path && x.Libraries.Intersect(policy.Libraries).Any());
            rule = rule != null ? Codec.Clone(rule) : new()
            {
                Id = policy.Id,
                Kind = kind,
                Path = item.Path!,
                Libraries = policy.Libraries,
                Label = policy.Label
            };
            // Exact manager edits use the existing correction rule and preserve its defaults.
            foreach (var(field, decision)in policy.Fields)
            {
                if (decision.Mode == "unmanaged" && !draft)
                    rule.Fields.Decisions.Remove(field);
                else
                    rule.Fields.Decisions[field] = Codec.Clone(decision);
            }

            var metadata = Codec.Clone(policy);
            metadata.Id = rule.Id;
            metadata.Fields = [];
            rule.Metadata = metadata;
            rule.Libraries = policy.Libraries;
            rule.Label = policy.Label;
            target.RemoveAll(x => x.Id == rule.Id);
            if (draft && rule.Fields.Decisions.Values.Any(f => f.Mode == "unmanaged") || rule.Fields.Values().Count > 0 || rule.TrackDefaults.Values().Count > 0 || policy.Images.Values.Any(x => x.Mode != "unmanaged") || policy.Bindings.Count > 0)
                target.Add(rule);
            if (!draft)
                d.Drafts.RemoveAll(x => x.Id == rule.Id);
        }
        else
        {
            var target = draft ? d.PolicyDrafts : d.Policies;
            target.RemoveAll(x => x.Id == policy.Id);
            target.Add(Codec.Clone(policy));
            if (!draft)
                d.PolicyDrafts.RemoveAll(x => x.Id == policy.Id);
        }
    }

    public void CandidateMetadata(Document d, Change c)
    {
        if (c.MetadataEdits is null || c.ActivatePolicies is null || c.DisablePolicies is null || c.DeletePolicies is null || c.Relinquish is null || c.CleanupIds is null)
            throw new ArgumentException("Manager change lists must not be null");
        var ids = c.MetadataEdits.Select(x => x.Id).Concat(c.ActivatePolicies).Concat(c.DisablePolicies).Concat(c.DeletePolicies).ToArray();
        if (ids.Distinct().Count() != ids.Length)
            throw new ArgumentException("A metadata policy cannot have multiple actions");
        foreach (var p in c.MetadataEdits.Concat(c.ActivatePolicies.Select(id => d.PolicyDrafts.SingleOrDefault(x => x.Id == id) ?? throw new ArgumentException("Metadata draft not found: " + id))))
            PutPolicy(d, p);
        foreach (var id in c.DisablePolicies)
        {
            var p = d.Policies.SingleOrDefault(x => x.Id == id) ?? throw new ArgumentException("Metadata policy not found");
            d.PolicyDrafts.RemoveAll(x => x.Id == id);
            d.PolicyDrafts.Add(Codec.Clone(p));
            d.Policies.RemoveAll(x => x.Id == id);
        }

        foreach (var id in c.DeletePolicies)
        {
            if (d.Policies.RemoveAll(x => x.Id == id) + d.PolicyDrafts.RemoveAll(x => x.Id == id) == 0)
                throw new ArgumentException("Metadata policy not found");
        }

        foreach (var r in c.Relinquish)
        {
            var item = inventory.Item(r.ItemId);
            foreach (var p in d.Policies.Where(x => inventory.Targets(x, d).Contains(item.Id)))
            {
                foreach (var field in r.Fields)
                    p.Fields.Remove(field);
                foreach (var type in r.Images)
                    p.Images.Remove(type);
            }

            foreach (var rule in d.Active.Where(x => x.Path == item.Path && x.Kind != "alias"))
            {
                foreach (var field in r.Fields)
                {
                    rule.Fields.Decisions.Remove(field);
                }

                if (rule.Metadata is { } meta)
                    foreach (var type in r.Images)
                        meta.Images.Remove(type);
            }
        }

        foreach (var oldPolicy in Doc.Policies)
        {
            var policyTargets = oldPolicy.IdentityId is null ? new[]
            {
                oldPolicy.ItemId
            }

            : new[]
            {
                Doc.Identities.Single(i => i.Id == oldPolicy.IdentityId).ArtistId
            };
            foreach (var id in policyTargets)
            {
                if (ExpandedRelinquish(c).Any(r => r.ItemId == id))
                    continue;
                var remaining = AllPolicies(d).Where(p => inventory.Targets(p, d).Contains(id)).ToArray();
                var fields = MetadataEngine.Values(oldPolicy.Fields).Keys.Except(remaining.SelectMany(p => MetadataEngine.Values(p.Fields).Keys)).ToArray();
                var images = oldPolicy.Images.Where(i => i.Value.Mode != "unmanaged").Select(i => i.Key).Except(remaining.SelectMany(p => p.Images.Where(i => i.Value.Mode != "unmanaged").Select(i => i.Key))).ToArray();
                if (fields.Length > 0 || images.Length > 0)
                    c.Relinquish = c.Relinquish.Append(new Relinquish { ItemId = id, Fields = fields, Images = images }).ToArray();
            }
        }

        // Per-field Unmanaged in the manager has the same retained-value semantics as Stop managing.
        // Include fields derived on child tracks by an edited album rule, while retaining explicit rule removal semantics.
        var requestedPaths = c.MetadataEdits.Where(p => p.ItemId != Guid.Empty).Select(p => library.GetItemById(p.ItemId)?.Path).Concat(c.Relinquish.Select(r => library.GetItemById(r.ItemId)?.Path)).Where(p => p != null).ToHashSet();
        var editedRules = Doc.Active.Where(r => r.Kind != "alias" && (requestedPaths.Contains(r.Path) || c.ActivateIds.Contains(r.Id) && d.Active.Any(n => n.Id == r.Id && n.Metadata != null))).ToArray();
        var explicitTargets = ExpandedRelinquish(c).Select(r => r.ItemId).ToHashSet();
        foreach (var item in projection.Items().Where(i => !explicitTargets.Contains(i.Id) && editedRules.Any(r => i.Path == r.Path || r.Kind == "album" && i is Audio && i.Path?.StartsWith(r.Path.TrimEnd('/') + "/", StringComparison.Ordinal) == true)))
        {
            if (!State.Records.TryGetValue(item.Id, out var old))
                continue;
            var remaining = projection.Project(item, projection.Baseline(projection.Describe(item)), d.Active).Values.Keys.ToHashSet();
            var relinquished = old.Applied.Keys.Except(remaining).ToArray();
            if (relinquished.Length > 0)
                c.Relinquish = c.Relinquish.Append(new Relinquish { ItemId = item.Id, Fields = relinquished }).ToArray();
        }

        foreach (var operation in ExpandedRelinquish(c).Where(x => x.RestoreOriginal && x.Fields.Contains("title")))
        {
            var identity = d.Identities.FirstOrDefault(x => x.ArtistId == operation.ItemId || x.PersonId == operation.ItemId);
            if (identity != null && State.IdentityNames.TryGetValue(identity.Id, out var originalName))
            {
                identity.Aliases = identity.Aliases.Append(identity.PreferredName).Distinct().ToArray();
                identity.PreferredName = originalName;
            }
        }

        d.Active.RemoveAll(x => x.Kind != "alias" && x.Fields.Values().Count == 0 && x.TrackDefaults.Values().Count == 0 && (x.Metadata is null || !x.Metadata.Images.Values.Any(i => i.Mode != "unmanaged") && x.Metadata.Bindings.Count == 0));
        foreach (var edited in c.IdentityEdits)
        {
            var old = Doc.Identities.FirstOrDefault(x => x.Id == edited.Id);
            if (old is null || old.PreferredName == edited.PreferredName)
                continue;
            var identity = d.Identities.First(x => x.Id == edited.Id);
            identity.Aliases = identity.Aliases.Append(old.PreferredName).Distinct().ToArray();
            foreach (var policy in d.Policies.Where(p => p.IdentityId == edited.Id && p.Fields.ContainsKey("title")))
                policy.Fields["title"] = new()
                {
                    Value = JsonSerializer.SerializeToElement(edited.PreferredName),
                    Provenance = "known"
                };
        }

        foreach (var policy in d.Policies.Where(x => x.IdentityId != null && x.Fields.TryGetValue("title", out var field) && field.Mode == "approved"))
        {
            var identity = d.Identities.SingleOrDefault(x => x.Id == policy.IdentityId) ?? throw new ArgumentException("Canonical identity missing");
            var name = policy.Fields["title"].Value.GetString()!;
            if (identity.PreferredName != name)
            {
                identity.Aliases = identity.Aliases.Append(identity.PreferredName).Distinct(StringComparer.Ordinal).ToArray();
                identity.PreferredName = name;
            }
        }
    }

    public void ValidateMetadata(Document d)
    {
        foreach (var group in AllPolicies(d).SelectMany(p => inventory.Targets(p, d).Select(id => (Id: id, Policy: p))).GroupBy(x => x.Id))
        {
            var fields = group.SelectMany(x => x.Policy.Fields.Where(f => f.Value.Mode != "unmanaged").Select(f => f.Key)).ToArray();
            var images = group.SelectMany(x => x.Policy.Images.Where(f => f.Value.Mode != "unmanaged").Select(f => f.Key)).ToArray();
            if (fields.Distinct().Count() != fields.Length || images.Distinct().Count() != images.Length)
                throw new ArgumentException("Conflicting standalone and canonical metadata for " + group.Key);
        }

        foreach (var policy in AllPolicies(d))
        {
            var unchanged = AllPolicies(Doc).Any(old => Codec.Hash(old) == Codec.Hash(policy));
            if (unchanged)
                continue;
            var targets = inventory.Targets(policy, d);
            if (targets.Length == 0)
                throw new ArgumentException("Metadata target missing");
            foreach (var id in targets)
            {
                var item = inventory.Item(id);
                inventory.EnsureWritable(item, policy.Libraries, d);
                if (item is MusicArtist or Person)
                {
                    var errors = MetadataEngine.ValidateFields(policy.Fields, true);
                    if (errors.Count > 0)
                        throw new ArgumentException(string.Join("\n", errors));
                }
            }

            sources.ValidatePolicy(policy, targets);
            foreach (var f in policy.Fields.Values.Where(x => x.Mode == "approved"))
                if (f.Value.ValueKind == JsonValueKind.Undefined)
                    throw new ArgumentException("Approved field requires a value");
            foreach (var locked in policy.Fields.Where(x => x.Key == "lockedFields" && x.Value.Mode == "approved").SelectMany(x => x.Value.Value.Deserialize<string[]>() ?? []))
                if (!Enum.TryParse<MetadataField>(locked, out _))
                    throw new ArgumentException("Unknown native lock: " + locked);
        }

        foreach (var rule in d.Active.Where(x => x.Fields.Decisions.Count > 0))
        {
            foreach (var locked in rule.Fields.Decisions.Where(x => x.Key == "lockedFields" && x.Value.Mode == "approved").SelectMany(x => x.Value.Value.Deserialize<string[]>() ?? []))
                if (!Enum.TryParse<MetadataField>(locked, out _))
                    throw new ArgumentException("Unknown native lock: " + locked);
            foreach (var item in projection.Items().Where(x => x.Path == rule.Path))
                inventory.EnsureWritable(item, rule.Libraries, d);
        }
    }

    public StoredImage[] ImageState(BaseItem item, string type)
    {
        var images = item.GetImages(Enum.Parse<ImageType>(type)).ToArray();
        return images.Select(x => new StoredImage(x.Path, File.Exists(x.Path) ? Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(x.Path))) : null)).ToArray();
    }

    public MetadataPreviewRow[] MetadataPreview(Document d)
    {
        List<MetadataPreviewRow> rows = [];
        foreach (var policy in AllPolicies(d))
            foreach (var id in inventory.Targets(policy, d))
            {
                var item = library.GetItemById(id);
                if (item == null)
                {
                    rows.Add(new MetadataPreviewRow { Id = id, PolicyId = policy.Id, Error = "Metadata target missing; rebind this policy", Sources = policy.Snapshots });
                    continue;
                }

                var actual = NativeMetadata.Read(item);
                var targets = MetadataEngine.Values(policy.Fields);
                rows.Add(new MetadataPreviewRow { Id = id, PolicyId = policy.Id, IdentityId = policy.IdentityId, Name = item.Name, Kind = item.GetType().Name, Before = actual, After = targets, Images = policy.Images, StoredImages = policy.Images.Keys.ToDictionary(x => x, x => ImageState(item, x)), Locks = item.LockedFields.Select(x => x.ToString()).ToArray(), IsLocked = item.IsLocked, Dependencies = inventory.Inspect(item, policy.Libraries, d), Sources = policy.Snapshots, ScrobblingRelevant = item is Audio or MusicAlbum && d.Active.Any(r => r.Path == item.Path && r.Fields.Values().Keys.Any(MetadataEngine.CoreFields.Contains)) });
            }

        return rows.ToArray();
    }

    public Relinquish[] ExpandedRelinquish(Change change) => change.Relinquish.SelectMany(r =>
    {
        var policy = Doc.Policies.FirstOrDefault(p => p.IdentityId != null && inventory.Targets(p, Doc).Contains(r.ItemId));
        return (policy == null ? new[]
        {
            r.ItemId
        }

        : inventory.Targets(policy, Doc)).Select(id => new Relinquish { ItemId = id, Fields = r.Fields, Images = r.Images, RestoreOriginal = r.RestoreOriginal });
    }).GroupBy(x => x.ItemId).Select(g => g.Single()).ToArray();
}
