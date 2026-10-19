using System.Collections;
using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using MediaBrowser.Controller.Library;
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
        finally { fixture.Configuration.Continue.Set(); }
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

    private sealed class Fixture : IDisposable
    {
        public ConfigurationMemory Configuration { get; } = new();
        public ManualClock Clock { get; } = new();
        public Corrections Service { get; }
        private readonly string directory = Path.Combine(Path.GetTempPath(), "manager-review-" + Guid.NewGuid());
        public Fixture()
        {
            var library = DispatchProxy.Create<ILibraryManager, EmptyMusicLibrary>();
            var storage = new PluginStorage(directory);
            var inventory = new Inventory(library, null!, null!, NullLogger<Inventory>.Instance, Configuration, storage, Clock);
            var sources = new Sources(library, null!, null!, null!, null!, storage, Clock);
            Service = new Corrections(library, null!, NullLogger<Corrections>.Instance, inventory, sources, null!, Configuration, new JsonJournalStore(storage), Clock, new RefreshQueue(), storage);
        }
        public Rule Rule(string label) => new() { Label = label, Kind = "track", Path = "/fixture-media/" + label + ".wav", Libraries = ["fixture-library"], Fields = new() { Title = label } };
        public void Dispose()
        {
            Configuration.Continue.Set();
            Configuration.Continue.Dispose();
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }

    private sealed class ConfigurationMemory : IConfigurationStore
    {
        public Document Current { get; private set; } = new();
        public bool Fail { get; set; }
        public bool BlockFirstSave { get; set; }
        public int SaveCount;
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ManualResetEventSlim Continue { get; } = new(false);
        public List<long> Revisions { get; } = [];
        public void Save(Document document)
        {
            var count = Interlocked.Increment(ref SaveCount);
            if (BlockFirstSave && count == 1)
            {
                Entered.TrySetResult();
                if (!Continue.Wait(TimeSpan.FromSeconds(5))) throw new TimeoutException("Fixture save was not released");
            }
            if (Fail) throw new IOException("Synthetic persistence failure");
            Current = Codec.Clone(document);
            Revisions.Add(document.Revision);
        }
    }
    private sealed class ManualClock : IClock { public DateTime UtcNow { get; set; } = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc); }
}

public class EmptyMusicLibrary : DispatchProxy
{
    protected override object? Invoke(MethodInfo? method, object?[]? args)
    {
        ArgumentNullException.ThrowIfNull(method);
        var type = method.ReturnType;
        if (method.Name == "GetVirtualFolders")
        {
            var element = type.GetGenericArguments()[0];
            var list = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(element))!;
            var folder = Activator.CreateInstance(element)!;
            element.GetProperty("ItemId")!.SetValue(folder, "fixture-library");
            element.GetProperty("Name")!.SetValue(folder, "Fixture music");
            element.GetProperty("Locations")!.SetValue(folder, new[] { "/fixture-media" });
            var collection = element.GetProperty("CollectionType")!;
            collection.SetValue(folder, Enum.Parse(Nullable.GetUnderlyingType(collection.PropertyType) ?? collection.PropertyType, "music", true));
            list.Add(folder);
            return list;
        }
        if (method.Name is "GetItemList" or "GetPeople")
        {
            if (type.IsArray) return Array.CreateInstance(type.GetElementType()!, 0);
            return Activator.CreateInstance(typeof(List<>).MakeGenericType(type.GetGenericArguments()[0]));
        }
        if (method.Name == "GetItemById") return null;
        throw new InvalidOperationException("Unexpected fixture library access: " + method.Name);
    }
}
