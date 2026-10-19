namespace MusicMetadataManager;
public sealed record Review(Change Change, string Fingerprint, DateTime Expires, Dictionary<Guid, string> CleanupHashes);
public sealed class ReviewSessions(IClock clock)
{
    private readonly Dictionary<string, Review> reviews = [];
    public void Clear() => reviews.Clear();
    public void Add(string token, Review review)
    {
        foreach (var expired in reviews.Where(x => x.Value.Expires < clock.UtcNow).Select(x => x.Key).ToArray())
            reviews.Remove(expired);
        reviews[token] = review;
    }

    public Review Require(string token) => token is not null && reviews.TryGetValue(token, out var review) && review.Expires >= clock.UtcNow ? review : throw new InvalidOperationException("Preview expired. Preview again.");
}
