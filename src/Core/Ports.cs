namespace MusicMetadataManager;
public interface IClock
{
    DateTime UtcNow { get; }
}

public interface IPluginStorage
{
    string DirectoryPath { get; }
}

public sealed record RefreshWork(Guid Id, bool Refresh);
public interface IRefreshQueue
{
    void Enqueue(Guid id, bool refresh);
    int Count();
    IAsyncEnumerable<RefreshWork> ReadAllAsync(CancellationToken token);
    void Complete();
}
