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
public sealed class CorrectionOperations(ILibraryManager library, ILogger<CorrectionOperations> logger, IMusicInventory inventory, StateCoordinator state, IClock clock, IRefreshQueue refreshQueue, ReviewProjection reviewProjection, MetadataPolicies policies, DocumentValidator validator, ReportService reports, ReviewedCleanup cleanup)
{
    SemaphoreSlim gate => state.Gate;

    Journal State => state.Journal;

    Document Doc => state.Document;

    void SaveState() => state.Commit();
    public LibraryInfo[] Libraries() => library.GetVirtualFolders().Where(x => x.CollectionType?.ToString().Equals("music", StringComparison.OrdinalIgnoreCase) == true).Select(x => new LibraryInfo(x.ItemId, x.Name, x.Locations)).ToArray();
    public async Task<QueueResult> ApplyAll(CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var p = reviewProjection.MakePreview(Doc);
            var ids = p.Items.Select(x => x.Id).Concat(policies.ManagedTargets(Doc)).Concat(State.Restores.Keys).Distinct().ToArray();
            foreach (var id in ids)
                State.Pending.TryAdd(id, false);
            SaveState();
            foreach (var row in p.Items)
                refreshQueue.Enqueue(row.Id, false);
            foreach (var id in policies.ManagedTargets(Doc).Concat(State.Restores.Keys).Distinct())
                refreshQueue.Enqueue(id, false);
            return new QueueResult(ids.Length);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<StatusResponse> Status(CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var p = reviewProjection.MakePreview(Doc);
            return new StatusResponse(Doc.Revision, Doc.Active.Count, Doc.Drafts.Count, Doc.Identities.Count, Doc.IdentityDrafts.Count, AliasService.Reports(library, Doc.Identities), State.Records.Values.Count(x => x.RuleIds.Length > 0), Doc.Policies.Count, Doc.PolicyDrafts.Count, State.Records.Values.Count(x => x.Applied.Count > 0 || x.AppliedImages.Count > 0), State.History.TakeLast(100).ToArray(), State.DeletedRecords.Where(x => library.GetItemById(x.Key) != null).ToArray(), refreshQueue.Count(), State.Pending.Count, State.Reports.Where(x => x.ArchivedAt == null).ToArray(), p.UnmatchedRules);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<RefreshWork[]> Recovery(CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            validator.Validate(Doc);
            inventory.RecoverMembership(State);
            cleanup.Recover(Doc);
            return State.Pending.Select(pair => new RefreshWork(pair.Key, pair.Value)).ToArray();
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
            reports.AddReport(message, id, FailureCodes.For(e));
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
            if (State.Pending.Remove(id))
            {
                reports.AddReport($"{id}: item no longer exists; pending refresh cancelled.", id, "item-missing");
                SaveState();
            }
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task QueueManaged(CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            foreach (var id in policies.ManagedTargets(Doc).Concat(State.Restores.Keys).Distinct())
                refreshQueue.Enqueue(id, false);
        }
        finally
        {
            gate.Release();
        }
    }
}
