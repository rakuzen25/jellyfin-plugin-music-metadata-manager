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
public sealed class ReviewedCleanup(ILibraryManager library, IMusicInventory inventory, StateCoordinator state, IPluginStorage storage, IClock clock, ReportService reports, ILogger<ReviewedCleanup> logger) : IReviewedCleanup
{
    SemaphoreSlim gate => state.Gate;

    Journal State => state.Journal;

    Document Doc => state.Document;

    void SaveState() => state.Commit();
    public Dictionary<Guid, string> Fingerprints(Guid[] ids, CleanupReview[] rows) => ids.Zip(rows).ToDictionary(pair => pair.First, pair => CleanupFingerprint(inventory.Item(pair.First), pair.Second));
    public CleanupReview CleanupSnapshot(BaseItem item, Document d)
    {
        var deps = inventory.Inspect(item, [], d);
        if (!deps.CanDelete)
            throw new InvalidOperationException(item.Name + " is not a verified orphan. Current dependencies or internal paths block deletion.");
        return new CleanupReview(item.Id, item.Name, deps, true, false, deps.MetadataPaths.SelectMany(p => CleanupFiles.Enumerate(p)).Distinct().OrderBy(p => p, StringComparer.Ordinal).Select(p => new FileFingerprint(p, Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p))))).ToArray());
    }

    public string CleanupFingerprint(BaseItem item, CleanupReview snapshot) => Codec.Hash(new { nativeType = item.GetType().FullName, snapshot });
    public CleanupReview[] CleanupPreview(Guid[] ids, Document d)
    {
        if (ids.Any(id => id == Guid.Empty) || ids.Distinct().Count() != ids.Length)
            throw new ArgumentException("Cleanup requires unique nonempty record IDs.");
        return ids.Select(id =>
        {
            var item = inventory.Item(id);
            try
            {
                return CleanupSnapshot(item, d);
            }
            catch (InvalidOperationException e)
            {
                throw new ArgumentException(e.Message, e);
            }
        }).ToArray();
    }

    public CleanupOutcome[] DeleteOrphans(Guid[] ids, Document d, Dictionary<Guid, string>? reviewed = null)
    {
        var results = new List<CleanupOutcome>();
        foreach (var id in ids)
        {
            string? recovery = null;
            bool deletionCompleted = false;
            try
            {
                // Only reviewed IDs bypass inventory filtering. Test-only unreviewed calls still require membership.
                if (reviewed != null && !reviewed.ContainsKey(id))
                    throw new InvalidOperationException("Record was not included in the cleanup preview.");
                var item = reviewed == null ? inventory.Item(id) : library.GetItemById(id) ?? throw new InvalidOperationException("Reviewed record no longer exists; refresh issues.");
                var snapshot = CleanupSnapshot(item, d);
                if (reviewed != null && CleanupFingerprint(item, snapshot) != reviewed[id])
                    throw new InvalidOperationException("Reviewed record type, dependencies or internal metadata changed; preview this record again.");
                var deps = inventory.Inspect(item, [], d);
                recovery = Path.Combine(storage.DirectoryPath, "recovery", clock.UtcNow.ToString("yyyyMMddTHHmmssfffffff") + "-" + id.ToString("N"));
                Directory.CreateDirectory(recovery);
                File.WriteAllText(Path.Combine(recovery, "record.json"), JsonSerializer.Serialize(new { id, item.Name, item.Path, fields = NativeMetadata.Read(item), dependencies = deps }, Codec.Json));
                foreach (var p in deps.MetadataPaths)
                {
                    var target = Path.Combine(recovery, "metadata-" + Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(p))));
                    foreach (var f in CleanupFiles.Enumerate(p))
                    {
                        var dest = Path.Combine(target, Path.GetRelativePath(p, f));
                        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                        File.Copy(f, dest);
                    }
                }

                // Reload again after recovery copying so replacement and concurrent changes are inspected.
                var current = library.GetItemById(id) ?? throw new InvalidOperationException("Reviewed record disappeared while retaining recovery material.");
                var finalSnapshot = CleanupSnapshot(current, d);
                if (CleanupFingerprint(current, finalSnapshot) != (reviewed?.GetValueOrDefault(id) ?? CleanupFingerprint(item, snapshot)))
                    throw new InvalidOperationException("Reviewed record or internal metadata changed while retaining recovery material; preview this record again.");
                if (State.CleanupPending.TryGetValue(id, out var admitted))
                {
                    admitted.RecoveryPath = recovery;
                    SaveState();
                }

                library.DeleteItem(current, new DeleteOptions { DeleteFileLocation = false, DeleteFromExternalProvider = false });
                deletionCompleted = true;
                State.CleanupPending.Remove(id);
                State.DeletedRecords[id] = current.Name;
                State.History.Add(new(clock.UtcNow, d.Revision, id, "delete verified orphan", []));
                SaveState();
                results.Add(new(id, "deleted", null, recovery));
            }
            catch (Exception e)
            {
                results.Add(new(id, deletionCompleted ? "deleted" : e is InvalidOperationException or ArgumentException ? "blocked" : "failed", e.Message, recovery));
                if (e is InvalidOperationException or ArgumentException)
                    State.CleanupPending.Remove(id);
                reports.AddReport("Cleanup " + id + ": " + e.Message, id, "cleanup-failure");
                try
                {
                    SaveState();
                }
                catch (Exception persistError)
                {
                    logger.LogError(persistError, "Could not persist cleanup failure for {ItemId}", id);
                }
            }
        }

        return results.ToArray();
    }

    public void Recover(Document document)
    {
        foreach (var pair in State.CleanupPending.ToArray())
        {
            try
            {
                RecoverOne(document, pair);
            }
            catch (Exception error)when (error is not OperationCanceledException)
            {
                logger.LogError(error, "Cleanup recovery failed for {ItemId}", pair.Key);
                reports.AddReport("Cleanup recovery " + pair.Key + ": " + error.Message, pair.Key, "cleanup-recovery-failure");
                try
                {
                    SaveState();
                }
                catch (Exception storageError)
                {
                    logger.LogError(storageError, "Unable to persist cleanup recovery failure for {ItemId}", pair.Key);
                }
            }
        }
    }

    private void RecoverOne(Document document, KeyValuePair<Guid, CleanupOperation> pair)
    {
        if (library.GetItemById(pair.Key)is not null)
        {
            DeleteOrphans([pair.Key], document, new() { { pair.Key, pair.Value.Fingerprint } });
            return;
        }

        var archive = pair.Value.RecoveryPath is null ? null : Path.Combine(pair.Value.RecoveryPath, "record.json");
        if (archive is not null && File.Exists(archive))
        {
            using var record = JsonDocument.Parse(File.ReadAllBytes(archive));
            if (record.RootElement.GetProperty("id").GetGuid() != pair.Key)
                throw new InvalidDataException("Cleanup recovery ID mismatch.");
            State.DeletedRecords[pair.Key] = record.RootElement.GetProperty("name").GetString() ?? "Deleted record";
            State.History.Add(new(clock.UtcNow, document.Revision, pair.Key, "delete verified orphan", []));
        }
        else
            reports.AddReport("Cleanup target disappeared before recovery material was retained.", pair.Key, "cleanup-target-missing");
        State.CleanupPending.Remove(pair.Key);
        SaveState();
    }
}
