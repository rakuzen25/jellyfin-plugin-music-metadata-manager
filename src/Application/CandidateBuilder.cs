using System.Text.Json;

namespace MusicMetadataManager;
public sealed class CandidateBuilder(StateCoordinator state, DocumentValidator validator, IMetadataPolicyEditor policies)
{
    SemaphoreSlim gate => state.Gate;

    Journal State => state.Journal;

    Document Doc => state.Document;

    public Document Candidate(Change c)
    {
        ChangeValidation.EnsureShape(c);
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

        policies.CandidateMetadata(d, c);
        validator.Validate(d);
        return d;
    }
}
