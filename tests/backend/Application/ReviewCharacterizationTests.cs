using MusicMetadataManager;
using Xunit;

namespace MusicMetadataManager.Tests;
public sealed class ReviewCharacterizationTests
{
    [Fact]
    public async Task SavingAnotherDraftInvalidatesTheExactReviewWithoutChangingActiveRules()
    {
        using var fixture = new Fixture();
        var cancellation = TestContext.Current.CancellationToken;
        var first = fixture.Rule("first");
        await fixture.Service.SaveDraft(first, cancellation);
        var review = await fixture.Service.Preview(new() { ActivateIds = [first.Id] }, cancellation);
        Assert.Empty(fixture.Configuration.Current.Active);
        await fixture.Service.SaveDraft(fixture.Rule("second"), cancellation);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Service.Activate(review.Token, cancellation));
        Assert.Empty(fixture.Configuration.Current.Active);
        Assert.Equal(2, fixture.Configuration.Current.Drafts.Count);
    }

    [Fact]
    public async Task ReviewExpiryUsesTheInjectedClockAndCannotCommit()
    {
        using var fixture = new Fixture();
        var cancellation = TestContext.Current.CancellationToken;
        var rule = fixture.Rule("expires");
        await fixture.Service.SaveDraft(rule, cancellation);
        var review = await fixture.Service.Preview(new() { ActivateIds = [rule.Id] }, cancellation);
        fixture.Clock.UtcNow = fixture.Clock.UtcNow.AddMinutes(16);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Service.Activate(review.Token, cancellation));
        Assert.Empty(fixture.Configuration.Current.Active);
        Assert.Equal(rule.Id, Assert.Single(fixture.Configuration.Current.Drafts).Id);
    }

    [Fact]
    public async Task ConcurrentDraftWritesKeepBothChangesInPersistenceOrder()
    {
        using var fixture = new Fixture();
        var cancellation = TestContext.Current.CancellationToken;
        fixture.Configuration.BlockFirstSave = true;
        var first = fixture.Rule("first");
        var second = fixture.Rule("second");
        var saving = Task.Run(() => fixture.Service.SaveDraft(first, cancellation), cancellation);
        await fixture.Configuration.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5), cancellation);
        var queued = fixture.Service.SaveDraft(second, cancellation);
        try
        {
            Assert.False(queued.IsCompleted);
            Assert.Equal(1, fixture.Configuration.SaveCount);
        }
        finally
        {
            fixture.Configuration.Continue.Set();
        }

        await Task.WhenAll(saving, queued);
        Assert.Equal(2, fixture.Configuration.Current.Revision);
        Assert.Equal(new[] { first.Id, second.Id }, fixture.Configuration.Current.Drafts.Select(rule => rule.Id));
        Assert.Equal(new[] { 1L, 2L }, fixture.Configuration.Revisions);
    }

    [Fact]
    public async Task FailedPersistenceKeepsThePreviousDocumentAndItsReview()
    {
        using var fixture = new Fixture();
        var cancellation = TestContext.Current.CancellationToken;
        var rule = fixture.Rule("reviewed");
        await fixture.Service.SaveDraft(rule, cancellation);
        var review = await fixture.Service.Preview(new() { ActivateIds = [rule.Id] }, cancellation);
        var before = Codec.Hash(fixture.Configuration.Current);
        fixture.Configuration.Fail = true;
        await Assert.ThrowsAsync<IOException>(() => fixture.Service.SaveDraft(fixture.Rule("failed"), cancellation));
        Assert.Equal(before, Codec.Hash(fixture.Configuration.Current));
        fixture.Configuration.Fail = false;
        await fixture.Service.Activate(review.Token, cancellation);
        Assert.Equal(rule.Id, Assert.Single(fixture.Configuration.Current.Active).Id);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Service.Activate(review.Token, cancellation));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(3)]
    public async Task UnknownDocumentFormatCannotImportOrChangeCurrentState(int version)
    {
        using var fixture = new Fixture();
        var before = Codec.Hash(fixture.Configuration.Current);
        var document = new Document
        {
            SchemaVersion = version
        };
        Assert.Contains("Unsupported rules schema version.", fixture.Service.Validation(document));
        await Assert.ThrowsAsync<ArgumentException>(() => fixture.Service.Import(document, TestContext.Current.CancellationToken));
        Assert.Equal(before, Codec.Hash(fixture.Configuration.Current));
        Assert.Equal(0, fixture.Configuration.SaveCount);
    }

    [Fact]
    public async Task FailedActivationCommitsNeitherStagedRestorationNorPendingWork()
    {
        using var fixture = new Fixture();
        fixture.Service.StageWork = true;
        var cancellation = TestContext.Current.CancellationToken;
        var rule = fixture.Rule("atomic");
        var review = await fixture.Service.Preview(new() { Edits = [rule] }, cancellation);
        fixture.Configuration.Fail = true;
        await Assert.ThrowsAsync<IOException>(() => fixture.Service.Activate(review.Token, cancellation));
        var failed = fixture.Configuration.Load();
        Assert.Empty(failed.Document.Active);
        Assert.Empty(failed.Journal.Pending);
        Assert.Empty(failed.Journal.Records);
        fixture.Configuration.Fail = false;
        await fixture.Service.Activate(review.Token, cancellation);
        var saved = fixture.Configuration.Load();
        Assert.Equal(rule.Id, Assert.Single(saved.Document.Active).Id);
        Assert.Contains(fixture.Service.TargetId, saved.Journal.Pending.Keys);
    }

    [Fact]
    public async Task QueueFailureAfterCommitRetainsAdmittedWorkAndConsumesTheReview()
    {
        using var fixture = new Fixture();
        fixture.Service.StageWork = true;
        fixture.Service.FailQueue = true;
        var cancellation = TestContext.Current.CancellationToken;
        var rule = fixture.Rule("recoverable");
        var review = await fixture.Service.Preview(new() { Edits = [rule] }, cancellation);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Service.Activate(review.Token, cancellation));
        var saved = fixture.Configuration.Load();
        Assert.Equal(rule.Id, Assert.Single(saved.Document.Active).Id);
        Assert.Contains(fixture.Service.TargetId, saved.Journal.Pending.Keys);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Service.Activate(review.Token, cancellation));
    }

    private sealed class Fixture : IDisposable
    {
        public StateMemory Configuration { get; } = new();
        public ManualClock Clock { get; } = new();
        public Workflow Service { get; }

        public Fixture() => Service = new(Configuration, Clock);
        public Rule Rule(string label) => new()
        {
            Label = label,
            Path = "/fixture-media/" + label + ".wav",
            Libraries = ["fixture-library"],
            Fields = new()
            {
                Title = label
            }
        };
        public void Dispose()
        {
            Configuration.Continue.Set();
            Configuration.Continue.Dispose();
        }
    }

    private sealed class StateMemory : IStateStore
    {
        private PluginState saved = new();
        public Document Current => Codec.Clone(saved.Document);
        public bool Fail { get; set; }
        public bool BlockFirstSave { get; set; }

        public int SaveCount;
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ManualResetEventSlim Continue { get; } = new(false);
        public List<long> Revisions { get; } = [];

        public PluginState Load() => Codec.Clone(saved);
        public void Save(PluginState state)
        {
            var count = Interlocked.Increment(ref SaveCount);
            if (BlockFirstSave && count == 1)
            {
                Entered.TrySetResult();
                if (!Continue.Wait(TimeSpan.FromSeconds(5)))
                    throw new TimeoutException();
            }

            if (Fail)
                throw new IOException("Synthetic persistence failure");
            saved = Codec.Clone(state);
            Revisions.Add(state.Document.Revision);
        }
    }

    private sealed class ManualClock : IClock
    {
        public DateTime UtcNow { get; set; } = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    }

    private sealed class Workflow : ILibraryCatalog, IMetadataPolicyEditor, IIdentityBindings, IReviewProjection, IRestorationService, IReviewedCleanup
    {
        private readonly DraftService drafts;
        private readonly StateCoordinator state;
        public bool StageWork { get; set; }
        public bool FailQueue { get; set; }
        public Guid TargetId { get; } = Guid.NewGuid();

        private readonly ReviewService reviews;
        public Workflow(StateMemory store, IClock clock)
        {
            state = new StateCoordinator(store);
            var validator = new DocumentValidator(this);
            var sessions = new ReviewSessions(clock);
            drafts = new(state, validator, this, sessions);
            reviews = new(state, new CandidateBuilder(state, validator, this), this, this, this, this, this, sessions, clock, new TestQueue(() => FailQueue), drafts);
        }

        public Task SaveDraft(Rule r, CancellationToken token) => drafts.SaveDraft(r, token);
        public Task<Preview> Preview(Change c, CancellationToken token) => reviews.Preview(c, token);
        public Task<ActivationResult> Activate(string token, CancellationToken cancellation) => reviews.Activate(token, cancellation);
        public string[] Validation(Document d) => drafts.Validation(d);
        public Task Import(Document d, CancellationToken token) => drafts.Import(d, token);
        public string[] LibraryIds() => ["fixture-library"];
        public void PutPolicy(Document d, MetadataPolicy p, bool draft = false) => throw new InvalidOperationException("Unexpected policy edit");
        public void CandidateMetadata(Document d, Change c)
        {
        }

        public void ValidateMetadata(Document d)
        {
        }

        public void Validate(ArtistIdentity identity)
        {
        }

        public Preview MakePreview(Document d) => new()
        {
            Items = StageWork ? [new()
            {
                Id = TargetId
            }

            ] : []
        };
        public RestorationPreview[] RelinquishPreview(Change c, Document d) => [];
        public Guid[] CommitMetadata(Document d, Change c)
        {
            if (!StageWork)
                return[];
            state.Journal.Records[TargetId] = new()
            {
                Id = TargetId
            };
            return[TargetId];
        }

        public CleanupReview[] CleanupPreview(Guid[] ids, Document d) => [];
        public Dictionary<Guid, string> Fingerprints(Guid[] ids, CleanupReview[] rows) => [];
        public CleanupOutcome[] DeleteOrphans(Guid[] ids, Document d, Dictionary<Guid, string>? hashes = null) => [];
    }

    private sealed class TestQueue(Func<bool> fail) : IRefreshQueue
    {
        public void Enqueue(Guid id, bool refresh)
        {
            if (fail())
                throw new InvalidOperationException("Synthetic queue admission failure");
        }

        public int Count() => 0;
        public IAsyncEnumerable<RefreshWork> ReadAllAsync(CancellationToken token) => throw new NotSupportedException();
        public void Complete() => throw new NotSupportedException();
    }
}
