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
public sealed partial class Corrections
{
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
        if (d.Policies.Concat(d.PolicyDrafts).Any(p => p is null || p.Fields is null || p.Libraries is null || p.Bindings is null || p.Snapshots is null || p.Images is null))
            throw new ArgumentException("Metadata policies and their lists must not be null.");
        var errors = Engine.Validate(d.Active);
        errors.AddRange(MetadataEngine.ValidatePolicies(d.Policies));
        foreach (var policy in d.PolicyDrafts)
            errors.AddRange(MetadataEngine.ValidatePolicies([policy]));
        if (d.PolicyDrafts.Select(x => x.Id).Distinct().Count() != d.PolicyDrafts.Count)
            errors.Add("Duplicate metadata draft IDs");
        if (d.Policies.Any(p => p.IdentityId != null && !d.Identities.Any(i => i.Id == p.IdentityId)))
            errors.Add("Stop managing canonical metadata before disabling or deleting its identity.");
        errors.AddRange(IdentityEngine.Validate(d.Identities));
        foreach (var identity in d.IdentityDrafts)
            errors.AddRange(IdentityEngine.Validate([identity]));
        if (d.IdentityDrafts.Select(x => x.Id).Distinct().Count() != d.IdentityDrafts.Count)
            errors.Add("Duplicate identity draft IDs.");
        foreach (var r in d.Drafts)
            errors.AddRange(Engine.Validate([r]));
        if (d.Drafts.Select(x => x.Id).Distinct().Count() != d.Drafts.Count)
            errors.Add("Duplicate draft IDs.");
        var libs = library.GetVirtualFolders().Where(x => x.CollectionType?.ToString().Equals("music", StringComparison.OrdinalIgnoreCase) == true).Select(x => x.ItemId).ToHashSet();
        if (d.Active.Concat(d.Drafts).Any(r => r?.Libraries is null || r.Libraries.Any(id => !libs.Contains(id))))
            errors.Add("Select existing music library IDs.");
        if (d.Policies.Concat(d.PolicyDrafts).Any(p => p.Libraries.Any(id => !libs.Contains(id))))
            errors.Add("Select existing music library IDs for metadata policies.");
        if (errors.Count > 0)
            throw new ArgumentException(string.Join("\n", errors.Distinct()));
    }

    public string[] Validation(Document d)
    {
        try
        {
            ValidateDocument(d);
            return[];
        }
        catch (ArgumentException e)
        {
            return e.Message.Split('\n');
        }
    }

    Document Candidate(Change c)
    {
        if (c.Edits is null || c.Edits.Any(r => r is null) || c.ActivateIds is null || c.DisableIds is null || c.DeleteIds is null)
            throw new ArgumentException("Rule ID lists must not be null.");
        var d = Codec.Clone(Doc);
        if (c.IdentityEdits is null || c.IdentityEdits.Any(x => x is null) || c.ActivateIdentities is null || c.DisableIdentities is null || c.DeleteIdentities is null)
            throw new ArgumentException("Identity change lists must not be null.");
        var identityIds = c.IdentityEdits.Select(x => x.Id).Concat(c.ActivateIdentities).Concat(c.DisableIdentities).Concat(c.DeleteIdentities).ToArray();
        if (identityIds.Distinct().Count() != identityIds.Length)
            throw new ArgumentException("An identity cannot have multiple actions.");
        foreach (var identity in c.IdentityEdits.Concat(c.ActivateIdentities.Select(id => d.IdentityDrafts.SingleOrDefault(x => x.Id == id) ?? throw new ArgumentException("Identity draft not found: " + id))))
        {
            d.Identities.RemoveAll(x => x.Id == identity.Id);
            d.Identities.Add(Codec.Clone(identity));
            d.IdentityDrafts.RemoveAll(x => x.Id == identity.Id);
        }

        foreach (var id in c.DisableIdentities)
        {
            var identity = d.Identities.SingleOrDefault(x => x.Id == id) ?? throw new ArgumentException("Identity not found: " + id);
            if (!d.IdentityDrafts.Any(x => x.Id == id))
                d.IdentityDrafts.Add(Codec.Clone(identity));
            d.Identities.RemoveAll(x => x.Id == id);
        }

        foreach (var id in c.DeleteIdentities)
        {
            if (!d.Identities.Concat(d.IdentityDrafts).Any(x => x.Id == id))
                throw new ArgumentException("Identity not found: " + id);
            d.Identities.RemoveAll(x => x.Id == id);
            d.IdentityDrafts.RemoveAll(x => x.Id == id);
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

        CandidateMetadata(d, c);
        ValidateDocument(d);
        return d;
    }

    public async Task<Document> Export(CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var exported = Codec.Clone(Doc);
            exported.SchemaVersion = 3;
            return exported;
        }
        finally
        {
            gate.Release();
        }
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
        finally
        {
            gate.Release();
        }
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
        finally
        {
            gate.Release();
        }
    }

    public async Task SaveIdentityDraft(ArtistIdentity identity, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var d = Codec.Clone(Doc);
            d.IdentityDrafts.RemoveAll(x => x.Id == identity.Id);
            d.IdentityDrafts.Add(Codec.Clone(identity));
            ValidateDocument(d);
            d.Revision++;
            Persist(d);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task DeleteIdentityDraft(string id, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var d = Codec.Clone(Doc);
            if (d.IdentityDrafts.RemoveAll(x => x.Id == id) == 0)
                throw new ArgumentException("Identity draft not found: " + id);
            d.Revision++;
            Persist(d);
        }
        finally
        {
            gate.Release();
        }
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

            foreach (var policy in input.Policies.Concat(input.PolicyDrafts).GroupBy(x => x.Id).Select(g => g.Last()))
            {
                d.PolicyDrafts.RemoveAll(x => x.Id == policy.Id);
                d.PolicyDrafts.Add(Codec.Clone(policy));
            }

            foreach (var identity in input.Identities.Concat(input.IdentityDrafts).GroupBy(x => x.Id).Select(g => g.Last()))
            {
                d.IdentityDrafts.RemoveAll(x => x.Id == identity.Id);
                d.IdentityDrafts.Add(Codec.Clone(identity));
            }

            ValidateDocument(d);
            d.Revision++;
            Persist(d);
        }
        finally
        {
            gate.Release();
        }
    }

    void Persist(Document d)
    {
        configuration.Save(d);
        reviews.Clear();
    }
}
