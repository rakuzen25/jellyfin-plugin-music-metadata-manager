using System.Collections.Concurrent;
using System.Threading.Channels;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
namespace MusicMetadataManager;

public sealed class Provider(Corrections corrections) : ICustomMetadataProvider<Audio>, ICustomMetadataProvider<MusicAlbum>, IHasOrder
{
    public string Name => "Music Metadata Manager"; public int Order => 1000;
    public Task<ItemUpdateType> FetchAsync(Audio item, MetadataRefreshOptions options, CancellationToken token) => corrections.Correct(item, false, token);
    public Task<ItemUpdateType> FetchAsync(MusicAlbum item, MetadataRefreshOptions options, CancellationToken token) => corrections.Correct(item, false, token);
}
public sealed class Worker(Corrections corrections, ILibraryManager library, IProviderManager providers, ILogger<Worker> logger, IRefreshQueue refreshQueue) : BackgroundService
{
    public void Queue(Guid id, bool refresh) => refreshQueue.Enqueue(id, refresh);
    void Completed(object? sender, Jellyfin.Data.Events.GenericEventArgs<BaseItem> e)
    {
        if (e.Argument is Audio or MusicAlbum or MusicArtist or MediaBrowser.Controller.Entities.Person)
            Queue(e.Argument.Id, false);
    }
    protected override async Task ExecuteAsync(CancellationToken token)
    {
        providers.RefreshCompleted += Completed;
        try
        {
            foreach (var id in await corrections.Recovery(token))
                Queue(id, true);
            await corrections.ApplyAll(token);
            await foreach (var work in refreshQueue.ReadAllAsync(token))
            {
                var id = work.Id;
                var refresh = work.Refresh;
                try
                {
                    if (refresh)
                        await corrections.Refresh(id, token);
                    var item = library.GetItemById(id);
                    if (item is not Audio && item is not MusicAlbum && item is not MusicArtist && item is not MediaBrowser.Controller.Entities.Person)
                    {
                        await corrections.Missing(id, token);
                        continue;
                    }
                    await corrections.Correct(item, true, token);
                    if (item is Audio && library.GetItemById(item.ParentId) is MusicAlbum parent)
                        await corrections.Correct(parent, true, token);
                }
                catch (Exception e) when (e is not OperationCanceledException) { await corrections.Error(id, e); }
                finally { refreshQueue.Complete(); }
            }
        }
        catch (Exception e) when (e is not OperationCanceledException) { logger.LogError(e, "Metadata correction worker stopped; check configuration and state."); }
        finally { providers.RefreshCompleted -= Completed; }
    }
}
public sealed class ScanCorrection(Corrections corrections) : ILibraryPostScanTask
{
    public async Task Run(IProgress<double> progress, CancellationToken token)
    {
        var items = corrections.Items();
        for (int i = 0; i < items.Length; i++)
        {
            try
            {
                await corrections.Correct(items[i], true, token);
            }
            catch (Exception e) when (e is not OperationCanceledException) { await corrections.Error(items[i].Id, e); }
            progress.Report(100.0 * (i + 1) / items.Length);
        }
        await corrections.QueueManaged(token);
    }
}
