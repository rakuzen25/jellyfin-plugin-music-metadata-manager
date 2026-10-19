using System.Text.Json;
using MusicMetadataManager;
using Xunit;
namespace MusicMetadataManager.Tests;

public sealed class PersistenceAndQueueTests
{
    [Fact]
    public void JournalPreservesRestorationAndPendingWorkAcrossReload()
    {
        var directory = Path.Combine(Path.GetTempPath(), "manager-journal-" + Guid.NewGuid());
        try
        {
            var store = new JsonJournalStore(new PluginStorage(directory));
            var id = Guid.NewGuid();
            var journal = new Journal { RefreshPending = [id], Items = new() { [id] = new() { Id = id, Original = new() { ["title"] = JsonSerializer.SerializeToElement("原曲") }, Applied = new() { ["title"] = JsonSerializer.SerializeToElement("Reviewed") } } } };
            store.Save(journal);
            var reloaded = store.Load();
            Assert.Equal(Codec.Hash(journal), Codec.Hash(reloaded));
            Assert.Equal("原曲", reloaded.Items[id].Original["title"].GetString());
            Directory.CreateDirectory(Path.Combine(directory, "state.json.tmp"));
            var failure = Xunit.Record.Exception(() => store.Save(new()));
            Assert.True(failure is IOException or UnauthorizedAccessException);
            Assert.Equal(Codec.Hash(journal), Codec.Hash(store.Load()));
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task DuplicateWorkKeepsRefreshAndReadmissionRemainsIndependent()
    {
        var queue = new RefreshQueue();
        var id = Guid.NewGuid();
        queue.Enqueue(id, false); queue.Enqueue(id, true); queue.Enqueue(id, false);
        Assert.Equal(1, queue.Count());
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        cancellation.CancelAfter(TimeSpan.FromSeconds(5));
        await using var reader = queue.ReadAllAsync(cancellation.Token).GetAsyncEnumerator(TestContext.Current.CancellationToken);
        Assert.True(await reader.MoveNextAsync());
        Assert.Equal(new RefreshWork(id, true), reader.Current);
        queue.Enqueue(id, false);
        Assert.Equal(2, queue.Count());
        queue.Complete();
        Assert.True(await reader.MoveNextAsync());
        Assert.False(reader.Current.Refresh);
        queue.Complete();
        Assert.Equal(0, queue.Count());
    }
}
