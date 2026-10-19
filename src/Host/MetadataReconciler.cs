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
public sealed class MetadataReconciler(ILibraryManager library, IProviderManager providers, IMusicInventory inventory, Sources sources, StateCoordinator state, MetadataPolicies policyService, IClock clock) : IRestorationService
{
    SemaphoreSlim gate => state.Gate;

    Journal State => state.Journal;

    Document Doc => state.Document;

    void SaveState() => state.Commit();
    public RestorationPreview[] RelinquishPreview(Change c, Document d) => policyService.ExpandedRelinquish(c).Select(r =>
    {
        var item = inventory.Item(r.ItemId);
        var original = new Dictionary<string, JsonElement>();
        var images = new Dictionary<string, ImageDecision>();
        foreach (var f in r.Fields)
        {
            if (State.Records.TryGetValue(item.Id, out var core) && core.Original.TryGetValue(f, out var v))
                original[f] = v;
            else if (State.Records.TryGetValue(item.Id, out var meta) && meta.Original.TryGetValue(f, out v))
                original[f] = v;
            else if (r.RestoreOriginal)
                throw new ArgumentException("No recorded original value for " + f);
        }

        foreach (var type in r.Images)
        {
            if (State.Records.TryGetValue(item.Id, out var meta) && meta.OriginalImages.TryGetValue(type, out var v))
                images[type] = v;
            else if (r.RestoreOriginal)
                throw new ArgumentException("No recorded original image for " + type);
        }

        return new RestorationPreview(item.Id, item.Name, r.RestoreOriginal ? "restore original" : "stop managing", NativeMetadata.Read(item), r.RestoreOriginal ? original : NativeMetadata.Read(item), images, r.Fields, r.Images);
    }).ToArray();
    public Guid[] CommitMetadata(Document next, Change change)
    {
        var targets = policyService.ManagedTargets(next).Concat(policyService.ManagedTargets(Doc)).Concat(change.Relinquish.Select(x => x.ItemId)).Distinct().ToArray();
        foreach (var policy in next.Policies.Where(p => p.IdentityId != null && p.Fields.ContainsKey("title")))
            State.IdentityNames.TryAdd(policy.IdentityId!, Doc.Identities.FirstOrDefault(x => x.Id == policy.IdentityId)?.PreferredName ?? next.Identities.First(x => x.Id == policy.IdentityId).PreferredName);
        foreach (var operation in policyService.ExpandedRelinquish(change))
        {
            var item = inventory.Item(operation.ItemId);
            var record = State.Records.GetValueOrDefault(item.Id);
            var fields = new Dictionary<string, JsonElement>();
            var images = new Dictionary<string, ImageDecision>();
            foreach (var field in operation.Fields)
            {
                if (record?.Original.TryGetValue(field, out var value) == true)
                    fields[field] = value;
                record?.Applied.Remove(field);
            }

            foreach (var type in operation.Images)
            {
                if (record?.OriginalImages.TryGetValue(type, out var value) == true)
                    images[type] = value;
                record?.AppliedImages.Remove(type);
            }

            if (operation.RestoreOriginal)
            {
                if (fields.Count != operation.Fields.Length || images.Count != operation.Images.Length)
                    throw new ArgumentException("Original values are unavailable for one or more requested fields");
                State.Restores[item.Id] = new()
                {
                    Fields = fields,
                    Images = images
                };
            }

            State.History.Add(new(clock.UtcNow, Doc.Revision + 1, item.Id, operation.RestoreOriginal ? "restore original" : "stop managing", operation.Fields.Concat(operation.Images).ToArray()));
        }

        return targets;
    }

    public async Task<ItemUpdateType> CorrectMetadata(BaseItem item, bool persist, CancellationToken token)
    {
        if (!persist)
            return ItemUpdateType.None;
        var policies = policyService.AllPolicies(Doc).Where(x => inventory.Targets(x, Doc).Contains(item.Id)).ToArray();
        var targetFields = item is Audio or MusicAlbum ? new Dictionary<string, JsonElement>() : policies.SelectMany(x => MetadataEngine.Values(x.Fields)).ToDictionary(x => x.Key, x => x.Value);
        var targetImages = policies.SelectMany(x => x.Images.Where(i => i.Value.Mode != "unmanaged")).ToDictionary(x => x.Key, x => x.Value);
        var restore = State.Restores.GetValueOrDefault(item.Id);
        if (restore != null)
        {
            foreach (var f in restore.Fields)
                targetFields[f.Key] = f.Value;
            foreach (var image in restore.Images)
                targetImages[image.Key] = image.Value;
        }

        if (targetFields.Count == 0 && targetImages.Count == 0)
            return ItemUpdateType.None;
        // Recheck global uses on each write, including provider refreshes, not only activation.
        foreach (var p in policies)
            inventory.EnsureWritable(item, p.Libraries);
        var current = NativeMetadata.Read(item);
        var record = State.Records.GetValueOrDefault(item.Id) ?? new ManagedRecord
        {
            Id = item.Id
        };
        var changed = targetFields.Where(x => !Engine.Equal(current[x.Key], x.Value)).ToArray();
        foreach (var f in targetFields)
        {
            if (!record.Original.ContainsKey(f.Key))
                record.Original[f.Key] = current[f.Key];
            if (restore?.Fields.ContainsKey(f.Key) != true)
                record.Applied[f.Key] = f.Value;
        }

        foreach (var(type, decision)in targetImages)
        {
            if (!record.OriginalImages.ContainsKey(type))
                record.OriginalImages[type] = sources.CacheCurrent(item, type);
            if (restore?.Images.ContainsKey(type) != true)
                record.AppliedImages[type] = decision;
        }

        State.Records[item.Id] = record;
        SaveState();
        bool imageChanged = false;
        foreach (var decision in targetImages.Values.Where(x => x.Mode == "approved"))
            if (!sources.HasImage(decision.Hash!))
                throw new IOException("Pinned image unavailable or hash mismatch: " + decision.Hash);
        foreach (var f in changed)
            NativeMetadata.Write(item, f.Key, f.Value);
        if (item is Audio or MusicAlbum && changed.Any(x => x.Key is "artists" or "albumArtists"))
        {
            NativeMetadata.EnsureArtistRecords(library, item);
            await NativeMetadata.SaveCredits(library, item, token);
        }

        foreach (var(type, decision)in targetImages)
        {
            var nativeType = Enum.Parse<ImageType>(type);
            var registered = item.GetImages(nativeType).ToArray();
            if (decision.Mode == "empty")
            {
                if (registered.Length > 0)
                {
                    item.RemoveImages(registered);
                    imageChanged = true;
                }

                continue;
            }

            if (!sources.HasImage(decision.Hash!))
                throw new IOException("Pinned image unavailable or hash mismatch: " + decision.Hash);
            if (registered.Length == 1 && File.Exists(registered[0].Path) && Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(registered[0].Path))) == decision.Hash)
                continue;
            item.RemoveImages(registered);
            await using var stream = File.OpenRead(sources.ImagePath(decision.Hash!));
            await providers.SaveImage(item, stream, decision.Mime!, nativeType, 0, token);
            imageChanged = true;
        }

        if (changed.Length > 0 || imageChanged)
        {
            await library.UpdateItemAsync(item, item.GetParent()!, ItemUpdateType.MetadataEdit | (imageChanged ? ItemUpdateType.ImageUpdate : ItemUpdateType.None), token);
            State.History.Add(new(clock.UtcNow, Doc.Revision, item.Id, restore != null ? "restore" : "apply", changed.Select(x => x.Key).Concat(imageChanged ? targetImages.Keys : []).ToArray()));
        }

        State.Restores.Remove(item.Id);
        SaveState();
        return changed.Length > 0 || imageChanged ? ItemUpdateType.MetadataEdit : ItemUpdateType.None;
    }
}
