using MediaBrowser.Controller.Entities;

namespace MusicMetadataManager;
public sealed class Sources(SourceComparisons comparisons, ArtworkService artwork)
{
    public string ImagePath(string hash) => artwork.ImagePath(hash);
    public bool HasImage(string hash) => artwork.HasImage(hash);
    public SourceProviderInfo[] Providers(BaseItem item) => comparisons.Providers(item);
    public Task<Comparison> Compare(CompareRequest request, CancellationToken token) => comparisons.Compare(request, token);
    public Task<ImageDecision> Cache(ImageCacheRequest request, CancellationToken token) => artwork.Cache(request, comparisons.RequireImage(request), token);
    public Task<ImageDecision> Upload(Stream stream, CancellationToken token) => artwork.Upload(stream, token);
    public ImageDecision CacheCurrent(BaseItem item, string type) => artwork.CacheCurrent(item, type);
    public void ValidatePolicy(MetadataPolicy policy, IEnumerable<Guid> targets) => comparisons.ValidatePolicy(policy, targets);
}
