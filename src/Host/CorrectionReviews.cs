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
    public async Task<Preview> Preview(Change c, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var d = Candidate(c);
            foreach (var identity in d.Identities.Where(x => !Doc.Identities.Any(old => Codec.Hash(old) == Codec.Hash(x))))
                AliasService.ValidateBindings(library, identity);
            ValidateMetadata(d);
            var p = MakePreview(d);
            p.Cleanup = CleanupPreview(c.CleanupIds, d);
            p.Restoration = RelinquishPreview(c, d);
            var cleanup = p.Cleanup;
            p.Cleanup = [];
            var fingerprint = Codec.Hash(new { document = d, preview = p });
            p.Cleanup = cleanup;
            p.Token = Guid.NewGuid().ToString("N");
            foreach (var expired in reviews.Where(x => x.Value.Expires < clock.UtcNow).Select(x => x.Key).ToArray())
                reviews.Remove(expired);
            reviews[p.Token] = new(Codec.Clone(c), fingerprint, clock.UtcNow.AddMinutes(15), c.CleanupIds.Zip(cleanup).ToDictionary(pair => pair.First, pair => CleanupFingerprint(inventory.Item(pair.First), pair.Second)));
            return p;
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<object> Activate(string token, CancellationToken cancellation)
    {
        await gate.WaitAsync(cancellation);
        try
        {
            if (!reviews.TryGetValue(token, out var review) || review.Expires < clock.UtcNow)
                throw new InvalidOperationException("Preview expired. Preview again.");
            Document d;
            Preview p;
            try
            {
                d = Candidate(review.Change);
                ValidateMetadata(d);
                p = MakePreview(d);
                p.Restoration = RelinquishPreview(review.Change, d);
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
            var refreshIds = ids.Where(id => !review.Change.Relinquish.Any(r => r.ItemId == id) && State.Items.TryGetValue(id, out var prior) && prior.RuleIds.Any(changedRules.Contains)).ToHashSet();
            var previousState = Codec.Clone(State);
            Guid[] managerIds;
            try
            {
                State.RefreshPending = State.RefreshPending.Concat(refreshIds).Distinct().ToList();
                managerIds = CommitMetadata(d, review.Change);
                d.Revision++;
                Persist(d);
            }
            catch
            {
                journal = previousState;
                SaveState();
                throw;
            }

            var cleanupResults = DeleteOrphans(review.Change.CleanupIds, d, review.CleanupHashes);
            foreach (var managerId in managerIds)
                refreshQueue.Enqueue(managerId, false);
            foreach (var id in ids)
                refreshQueue.Enqueue(id, refreshIds.Contains(id));
            return new
            {
                cleanupResults,
                revision = d.Revision,
                queued = ids.Concat(managerIds).Distinct().Count()
            };
        }
        finally
        {
            gate.Release();
        }
    }
}
