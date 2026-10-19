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
            var store = new JsonStateStore(new PluginStorage(directory));
            var id = Guid.NewGuid();
            var journal = new PluginState
            {
                Journal = new Journal
                {
                    Pending = new()
                    {
                        {
                            id,
                            true
                        }
                    },
                    Records = new()
                    {
                        [id] = new()
                        {
                            Id = id,
                            Original = new()
                            {
                                ["title"] = JsonSerializer.SerializeToElement("原曲")
                            },
                            Applied = new()
                            {
                                ["title"] = JsonSerializer.SerializeToElement("Reviewed")
                            }
                        }
                    }
                }
            };
            store.Save(journal);
            var reloaded = store.Load();
            Assert.Equal(Codec.Hash(journal), Codec.Hash(reloaded));
            Assert.Equal("原曲", reloaded.Journal.Records[id].Original["title"].GetString());
            Directory.CreateDirectory(Path.Combine(directory, "state.json.tmp"));
            var failure = Xunit.Record.Exception(() => store.Save(new()));
            Assert.True(failure is IOException or UnauthorizedAccessException);
            Assert.Equal(Codec.Hash(journal), Codec.Hash(store.Load()));
        }
        finally
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, true);
        }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(3)]
    public void UnknownJournalFormatIsRejectedWithoutRewritingState(int version)
    {
        var directory = Path.Combine(Path.GetTempPath(), "manager-journal-" + Guid.NewGuid());
        try
        {
            Directory.CreateDirectory(directory);
            var file = Path.Combine(directory, "state.json");
            var invalid = JsonSerializer.Serialize(new PluginState { SchemaVersion = version }, Codec.Json);
            File.WriteAllText(file, invalid);
            var store = new JsonStateStore(new PluginStorage(directory));
            Assert.Throws<InvalidDataException>(() => store.Load());
            Assert.Equal(invalid, File.ReadAllText(file));
            Assert.Throws<InvalidDataException>(() => store.Save(new PluginState { SchemaVersion = version }));
            Assert.Equal(invalid, File.ReadAllText(file));
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    [Fact]
    public void JournalRequiresCurrentFormatAndReportsInsteadOfConvertingOldErrors()
    {
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<PluginState>("{}", Codec.Json));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<PluginState>("{\"schemaVersion\":1,\"errors\":[],\"acknowledgedErrors\":[]}", Codec.Json));
        var directory = Path.Combine(Path.GetTempPath(), "manager-fresh-" + Guid.NewGuid());
        Assert.False(Directory.Exists(directory));
        var journal = new JsonStateStore(new PluginStorage(directory)).Load();
        Assert.Equal(1, journal.SchemaVersion);
        Assert.Empty(journal.Journal.Reports);
        Assert.False(Directory.Exists(directory));
    }

    [Fact]
    public async Task DuplicateWorkKeepsRefreshAndReadmissionRemainsIndependent()
    {
        var queue = new RefreshQueue();
        var id = Guid.NewGuid();
        queue.Enqueue(id, false);
        queue.Enqueue(id, true);
        queue.Enqueue(id, false);
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
