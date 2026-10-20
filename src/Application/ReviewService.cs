using System.Text.Json;

namespace MusicMetadataManager;
public sealed class ReviewService(StateCoordinator state, CandidateBuilder candidates, IIdentityBindings bindings, IMetadataPolicyEditor policies, IReviewProjection projection, IRestorationService restoration, IReviewedCleanup cleanupService, ReviewSessions reviews, IClock clock, IRefreshQueue refreshQueue, DraftService drafts)
{
    SemaphoreSlim gate => state.Gate;

    Journal State => state.Journal;

    Document Doc => state.Document;

    public async Task<Preview> Preview(Change c, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            c = Codec.Clone(c);
            var d = candidates.Candidate(c);
            foreach (var identity in d.Identities.Where(x => !Doc.Identities.Any(old => Codec.Hash(old) == Codec.Hash(x))))
                bindings.Validate(identity);
            policies.ValidateMetadata(d);
            var p = projection.MakePreview(d);
            p.Cleanup = cleanupService.CleanupPreview(c.CleanupIds, d);
            p.Restoration = restoration.RelinquishPreview(c, d);
            var cleanup = p.Cleanup;
            p.Cleanup = [];
            var fingerprint = Codec.Hash(new { document = d, preview = p });
            p.Cleanup = cleanup;
            p.Token = Guid.NewGuid().ToString("N");
            reviews.Add(p.Token, new(Codec.Clone(c), fingerprint, clock.UtcNow.AddMinutes(15), cleanupService.Fingerprints(c.CleanupIds, cleanup)));
            return p;
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<ActivationResult> Activate(string token, CancellationToken cancellation)
    {
        await gate.WaitAsync(cancellation);
        try
        {
            var review = reviews.Require(token);
            var change = Codec.Clone(review.Change);
            Document d;
            Preview p;
            try
            {
                d = candidates.Candidate(change);
                policies.ValidateMetadata(d);
                p = projection.MakePreview(d);
                p.Restoration = restoration.RelinquishPreview(change, d);
            }
            catch (ArgumentException e)
            {
                throw new InvalidOperationException("Reviewed metadata or dependencies changed. Preview again. " + e.Message, e);
            }

            if (Codec.Hash(new { document = d, preview = p }) != review.Fingerprint)
                throw new InvalidOperationException("Rules or affected metadata changed. Preview again.");
            var ids = Codec.Hash(d.Active) == Codec.Hash(Doc.Active) ? [] : p.Items.Select(x => x.Id).ToArray();
            // New rules can be applied directly. Refresh only items managed by a
            // changed or removed active rule, preserving unrelated provider metadata.
            var changedRules = Doc.Active.Where(old => !d.Active.Any(next => next.Id == old.Id && Codec.Hash(next) == Codec.Hash(old))).Select(x => x.Id).ToHashSet();
            var refreshIds = ids.Where(id => !change.Relinquish.Any(r => r.ItemId == id) && State.Records.TryGetValue(id, out var prior) && prior.RuleIds.Any(changedRules.Contains)).ToHashSet();
            Guid[] managerIds;
            try
            {
                managerIds = restoration.CommitMetadata(d, change);
                foreach (var id in ids.Concat(managerIds).Distinct())
                    State.Pending[id] = State.Pending.GetValueOrDefault(id) || refreshIds.Contains(id);
                foreach (var pair in review.CleanupHashes)
                    State.CleanupPending[pair.Key] = new()
                    {
                        Fingerprint = pair.Value
                    };
                d.Revision++;
                drafts.Persist(d);
            }
            catch
            {
                state.Rollback();
                throw;
            }

            var cleanupResults = cleanupService.DeleteOrphans(review.Change.CleanupIds, d, review.CleanupHashes);
            foreach (var managerId in managerIds)
                refreshQueue.Enqueue(managerId, false);
            foreach (var id in ids)
                refreshQueue.Enqueue(id, refreshIds.Contains(id));
            return new ActivationResult(cleanupResults, d.Revision, ids.Concat(managerIds).Distinct().Count());
        }
        finally
        {
            gate.Release();
        }
    }
}
