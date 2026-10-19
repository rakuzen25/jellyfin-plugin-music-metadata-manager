using MediaBrowser.Controller;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;

namespace MusicMetadataManager;
// Provider completion events are not emitted for every artist refresh on this build.
// Delegate the complete native metadata service first, then reconcile via the existing gate.
public sealed class RefreshBoundary(IServerApplicationHost host, Corrections corrections) : IMetadataService
{
    readonly object sync = new();
    IMetadataService[]? services;
    public int Order => -10000;

    public bool CanRefresh(BaseItem item) => item is Audio or MusicAlbum or MusicArtist or Person;
    public bool CanRefreshPrimary(Type type) => type == typeof(Audio) || type == typeof(MusicAlbum) || type == typeof(MusicArtist) || type == typeof(Person);
    IMetadataService Native(BaseItem item)
    {
        lock (sync)
        {
            services ??= host.GetExports<IMetadataService>().Where(x => x is not RefreshBoundary).OrderBy(x => x.Order).ToArray();
            return services.FirstOrDefault(x => x.CanRefreshPrimary(item.GetType())) ?? services.First(x => x.CanRefresh(item));
        }
    }

    public async Task<ItemUpdateType> RefreshMetadata(BaseItem item, MetadataRefreshOptions options, CancellationToken token)
    {
        var result = await Native(item).RefreshMetadata(item, options, token);
        try
        {
            return result | await corrections.Correct(item, true, token);
        }
        catch (Exception e)when (e is not OperationCanceledException)
        {
            await corrections.Error(item.Id, e);
            return result;
        }
    }
}
