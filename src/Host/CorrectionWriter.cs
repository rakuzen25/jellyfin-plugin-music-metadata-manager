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
public sealed class CorrectionWriter(ILibraryManager library, IFileSystem fileSystem, ILogger<CorrectionWriter> logger, StateCoordinator state, RuleProjection projection, MetadataReconciler metadata, ReconciliationService reconciliation)
{
    SemaphoreSlim gate => state.Gate;

    Journal State => state.Journal;

    Document Doc => state.Document;

    void SaveState() => state.Commit();
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
            {
                var result = await metadata.CorrectMetadata(item, persist, token);
                if (persist)
                    reconciliation.Acknowledge(item.Id);
                return result;
            }

            if (item is not Audio && item is not MusicAlbum)
                return ItemUpdateType.None;
            var actual = projection.Describe(item);
            if (actual.Library == "")
                return ItemUpdateType.None;
            var baseline = projection.Baseline(actual, !persist);
            var plan = projection.Project(item, baseline, Doc.Active);
            if (!persist && plan.Values.Count == 0)
                return ItemUpdateType.None;
            var prepared = reconciliation.Prepare(actual, baseline, plan, persist);
            var changed = prepared.Changed;
            bool changedPeople = changed.ContainsKey("artists") || changed.ContainsKey("albumArtists");
            if (changed.Count > 0)
                reconciliation.Stage(prepared);
            foreach (var p in changed)
                NativeMetadata.Write(item, p.Key, p.Value);
            if (plan.Values.ContainsKey("artists") || plan.Values.ContainsKey("albumArtists"))
                NativeMetadata.EnsureArtistRecords(library, item);
            if (changedPeople)
                await NativeMetadata.SaveCredits(library, item, token);
            if (changed.Count > 0 && persist)
                await library.UpdateItemAsync(item, library.GetItemById(item.ParentId)!, ItemUpdateType.MetadataEdit, token);
            reconciliation.RecordSuccess(prepared);
            var metadataResult = await metadata.CorrectMetadata(item, persist, token);
            if (persist)
                reconciliation.Acknowledge(item.Id);
            if (changed.Count > 0)
                logger.LogInformation("Corrected {Path}: {Fields}", item.Path, string.Join(", ", changed.Keys));
            return (changed.Count > 0 ? ItemUpdateType.MetadataEdit : ItemUpdateType.None) | metadataResult;
        }
        finally
        {
            gate.Release();
        }
    }
}
