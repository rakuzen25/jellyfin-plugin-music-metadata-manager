using MusicMetadataManager;
using Xunit;

namespace MusicMetadataManager.Tests;
public sealed class StateCoordinatorTests
{
    [Fact]
    public void FailedCommitRollsBackDocumentJournalAndPendingWorkTogether()
    {
        var store = new MemoryStore();
        var state = new StateCoordinator(store);
        var id = Guid.NewGuid();
        var doc = Codec.Clone(state.Document);
        doc.Revision = 1;
        state.Journal.Pending[id] = true;
        state.Journal.Records[id] = new()
        {
            Id = id
        };
        store.Fail = true;
        Assert.Throws<IOException>(() => state.Commit(doc));
        Assert.Equal(0, state.Current.Revision);
        Assert.Empty(state.Journal.Pending);
        Assert.Empty(state.Journal.Records);
        Assert.Empty(store.Load().Journal.Pending);
    }

    [Fact]
    public void ReadersCannotMutateTheCommittedOrWorkingDocument()
    {
        var state = new StateCoordinator(new MemoryStore());
        var read = state.Current;
        read.Revision = 99;
        read.Drafts.Add(new());
        Assert.Equal(0, state.Document.Revision);
        Assert.Empty(state.Current.Drafts);
    }

    [Fact]
    public void RestartLoadsTheMatchingDocumentRestorationAndStrongestWorkIntent()
    {
        var store = new MemoryStore();
        var state = new StateCoordinator(store);
        var id = Guid.NewGuid();
        var doc = Codec.Clone(state.Document);
        doc.Revision = 7;
        state.Journal.Pending[id] = true;
        state.Journal.Restores[id] = new()
        {
            Fields = new()
            {
                ["overview"] = System.Text.Json.JsonSerializer.SerializeToElement("Original")
            }
        };
        state.Commit(doc);
        var restart = new StateCoordinator(store);
        Assert.Equal(7, restart.Current.Revision);
        Assert.True(restart.Journal.Pending[id]);
        Assert.Equal("Original", restart.Journal.Restores[id].Fields["overview"].GetString());
    }

    [Fact]
    public async Task CancelledDraftWriteNeverMutatesOrPersistsState()
    {
        var store = new MemoryStore();
        var state = new StateCoordinator(store);
        var validator = new DocumentValidator(new Catalog());
        var drafts = new DraftService(state, validator, new Policies(), new ReviewSessions(new Clock()));
        await state.Gate.WaitAsync(TestContext.Current.CancellationToken);
        try
        {
            using var cancellation = new CancellationTokenSource();
            cancellation.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => drafts.SaveDraft(new(), cancellation.Token));
            Assert.Empty(state.Document.Drafts);
            Assert.Equal(0, store.Saves);
        }
        finally
        {
            state.Gate.Release();
        }
    }

    private sealed class MemoryStore : IStateStore
    {
        private PluginState saved = new();
        public bool Fail;
        public int Saves;
        public PluginState Load() => Codec.Clone(saved);
        public void Save(PluginState snapshot)
        {
            if (Fail)
                throw new IOException("Synthetic atomic write failure");
            saved = Codec.Clone(snapshot);
            Saves++;
        }
    }

    private sealed class Catalog : ILibraryCatalog
    {
        public string[] LibraryIds() => ["music"];
    }

    private sealed class Clock : IClock
    {
        public DateTime UtcNow => new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    }

    private sealed class Policies : IMetadataPolicyEditor
    {
        public void PutPolicy(Document document, MetadataPolicy policy, bool draft = false) => throw new NotSupportedException();
        public void CandidateMetadata(Document document, Change change) => throw new NotSupportedException();
        public void ValidateMetadata(Document document) => throw new NotSupportedException();
    }
}
