using System.Text.Json;

namespace MusicMetadataManager;
public sealed class DraftService(StateCoordinator state, DocumentValidator validator, IMetadataPolicyEditor policies, ReviewSessions reviews)
{
    SemaphoreSlim gate => state.Gate;

    Journal State => state.Journal;

    Document Doc => state.Document;

    public string[] Validation(Document d)
    {
        try
        {
            validator.Validate(d);
            return[];
        }
        catch (ArgumentException e)
        {
            return e.Message.Split('\n');
        }
    }

    public async Task<Document> Export(CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var exported = Codec.Clone(Doc);
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
            validator.Validate(d);
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
            validator.Validate(d);
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
            DocumentValidation.EnsureShape(input);
            if (input.Active is null || input.Drafts is null || input.Identities is null || input.IdentityDrafts is null || input.Policies is null || input.PolicyDrafts is null)
                throw new ArgumentException("Rule lists must not be null.");
            if (input.SchemaVersion != DataFormat.Version)
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

            validator.Validate(d);
            d.Revision++;
            Persist(d);
        }
        finally
        {
            gate.Release();
        }
    }

    public void Persist(Document d)
    {
        state.Commit(d);
        reviews.Clear();
    }

    public async Task SaveMetadataDraft(MetadataPolicy p, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var d = Codec.Clone(Doc);
            policies.PutPolicy(d, p, true);
            validator.Validate(d);
            d.Revision++;
            Persist(d);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task DeleteMetadataDraft(string id, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var d = Codec.Clone(Doc);
            if (d.PolicyDrafts.RemoveAll(x => x.Id == id) == 0)
                throw new ArgumentException("Metadata draft not found");
            d.Revision++;
            Persist(d);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<DiscardResult> DiscardDrafts(DraftDiscard input, CancellationToken token)
    {
        if (input.Targets is null || input.Targets.Length == 0 || input.Targets.Any(t => t is null || string.IsNullOrWhiteSpace(t.Id) || t.Kind is not ("rule" or "identity" or "policy")))
            throw new ArgumentException("Choose valid typed draft targets.");
        if (input.Targets.Select(t => (t.Kind, t.Id)).Distinct().Count() != input.Targets.Length)
            throw new ArgumentException("Duplicate draft targets are not allowed.");
        await gate.WaitAsync(token);
        try
        {
            if (input.ExpectedRevision != Doc.Revision)
                throw new InvalidOperationException("Configuration changed. Reload the selection before discarding drafts.");
            var d = Codec.Clone(Doc);
            foreach (var target in input.Targets)
            {
                var removed = target.Kind switch
                {
                    "rule" => d.Drafts.RemoveAll(x => x.Id == target.Id),
                    "identity" => d.IdentityDrafts.RemoveAll(x => x.Id == target.Id),
                    "policy" => d.PolicyDrafts.RemoveAll(x => x.Id == target.Id),
                    _ => 0
                };
                if (removed != 1)
                    throw new ArgumentException("Draft not found: " + target.Kind + ":" + target.Id);
            }

            d.Revision++;
            Persist(d);
            return new DiscardResult(input.Targets, d.Revision);
        }
        finally
        {
            gate.Release();
        }
    }
}
