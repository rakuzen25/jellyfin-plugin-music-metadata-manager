using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging.Abstractions;
using System.Reflection;
using MusicMetadataManager;
using Xunit;

namespace MusicMetadataManager.Tests;
public sealed class CleanupRecoveryTests
{
    [Fact]
    public void ChangedDependenciesBlockDeletionWithoutDiscardingTheRecord()
    {
        using var fixture = new Fixture();
        var review = fixture.Cleanup.CleanupPreview([fixture.Id], new());
        var hashes = fixture.Cleanup.Fingerprints([fixture.Id], review);
        fixture.Inventory.Blocked = true;
        var outcome = Assert.Single(fixture.Cleanup.DeleteOrphans([fixture.Id], new(), hashes));
        Assert.Equal("blocked", outcome.Outcome);
        Assert.Equal(0, fixture.Library.Deletes);
        Assert.True(File.Exists(fixture.MetadataFile));
    }

    [Fact]
    public void CleanupPreservesRecoveryBytesAndRecordsSuccessfulDeletion()
    {
        using var fixture = new Fixture();
        var preview = fixture.Cleanup.CleanupPreview([fixture.Id], new());
        var hashes = fixture.Cleanup.Fingerprints([fixture.Id], preview);
        fixture.State.Journal.CleanupPending[fixture.Id] = new()
        {
            Fingerprint = hashes[fixture.Id]
        };
        fixture.State.Commit();
        var outcome = Assert.Single(fixture.Cleanup.DeleteOrphans([fixture.Id], new(), hashes));
        Assert.Equal("deleted", outcome.Outcome);
        Assert.Equal(1, fixture.Library.Deletes);
        Assert.Contains(fixture.Id, fixture.Store.Load().Journal.DeletedRecords.Keys);
        Assert.Empty(fixture.Store.Load().Journal.CleanupPending);
        Assert.Contains(Directory.GetFiles(outcome.RecoveryPath!, "*", SearchOption.AllDirectories), file => Path.GetFileName(file) == "image.bin" && File.ReadAllText(file) == "original artwork");
    }

    [Fact]
    public void RestartFinishesAnAdmittedCleanupAfterRecheckingItsFingerprint()
    {
        using var fixture = new Fixture();
        var preview = fixture.Cleanup.CleanupPreview([fixture.Id], new());
        var hashes = fixture.Cleanup.Fingerprints([fixture.Id], preview);
        fixture.State.Journal.CleanupPending[fixture.Id] = new()
        {
            Fingerprint = hashes[fixture.Id]
        };
        fixture.State.Commit();
        fixture.Cleanup.Recover(new());
        Assert.Equal(1, fixture.Library.Deletes);
        Assert.Empty(fixture.Store.Load().Journal.CleanupPending);
    }

    [Fact]
    public void NestedSymbolicLinksBlockCleanupEnumeration()
    {
        var root = Path.Combine(Path.GetTempPath(), "cleanup-links-" + Guid.NewGuid());
        Directory.CreateDirectory(root);
        try
        {
            File.CreateSymbolicLink(Path.Combine(root, "outside"), "/etc/hosts");
            Assert.Throws<InvalidOperationException>(() => CleanupFiles.Enumerate(root));
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }

    [Fact]
    public void CorruptRecoveryEvidenceReportsTheItemWithoutStoppingOtherRecovery()
    {
        using var fixture = new Fixture();
        var recovery = Path.Combine(fixture.DirectoryPath, "corrupt-recovery");
        Directory.CreateDirectory(recovery);
        File.WriteAllText(Path.Combine(recovery, "record.json"), "{");
        fixture.Library.Other = null;
        fixture.State.Journal.CleanupPending[fixture.Id] = new()
        {
            Fingerprint = "reviewed",
            RecoveryPath = recovery
        };
        fixture.State.Commit();
        fixture.Cleanup.Recover(new());
        Assert.Contains(fixture.Id, fixture.Store.Load().Journal.CleanupPending.Keys);
        Assert.Contains(fixture.Store.Load().Journal.Reports, report => report.ItemId == fixture.Id && report.Code == "cleanup-recovery-failure");
        Assert.Equal(0, fixture.Library.Deletes);
    }

    [Fact]
    public void CompletedDeletionIsAcknowledgedAfterRestartUsingItsRetainedRecoveryEvidence()
    {
        using var fixture = new Fixture();
        var recovery = Path.Combine(fixture.DirectoryPath, "retained-recovery");
        Directory.CreateDirectory(recovery);
        File.WriteAllText(Path.Combine(recovery, "record.json"), System.Text.Json.JsonSerializer.Serialize(new { id = fixture.Id, name = "Retained orphan" }, Codec.Json));
        fixture.Library.Other = null;
        fixture.State.Journal.CleanupPending[fixture.Id] = new()
        {
            Fingerprint = "reviewed",
            RecoveryPath = recovery
        };
        fixture.State.Commit();
        fixture.Cleanup.Recover(new());
        Assert.Empty(fixture.Store.Load().Journal.CleanupPending);
        Assert.Equal("Retained orphan", fixture.Store.Load().Journal.DeletedRecords[fixture.Id]);
        Assert.Equal(0, fixture.Library.Deletes);
    }

    private sealed class Fixture : IDisposable
    {
        public readonly string DirectoryPath = Path.Combine(Path.GetTempPath(), "cleanup-test-" + Guid.NewGuid());
        public string MetadataFile => Path.Combine(DirectoryPath, "internal", "image.bin");
        public NativeLibrary Library { get; }
        public TestInventory Inventory { get; }
        public StateCoordinator State { get; }
        public ReviewedCleanup Cleanup { get; }
        public JsonStateStore Store { get; }
        public Guid Id => Inventory.Record.Id;

        public Fixture()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(MetadataFile)!);
            File.WriteAllText(MetadataFile, "original artwork");
            var library = DispatchProxy.Create<ILibraryManager, NativeLibrary>();
            Library = (NativeLibrary)(object)library;
            var record = new MusicArtist
            {
                Id = Guid.NewGuid(),
                Name = "Orphan",
                Path = Path.GetDirectoryName(MetadataFile)!
            };
            Library.Other = record;
            Inventory = new(record);
            var storage = new PluginStorage(Path.Combine(DirectoryPath, "state"));
            Store = new(storage);
            State = new(Store);
            var clock = new Clock();
            Cleanup = new(library, Inventory, State, storage, clock, new ReportService(State, clock), NullLogger<ReviewedCleanup>.Instance);
        }

        public void Dispose()
        {
            if (Directory.Exists(DirectoryPath))
                Directory.Delete(DirectoryPath, true);
        }
    }

    private sealed class Clock : IClock
    {
        public DateTime UtcNow => new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    }

    public sealed class TestInventory(BaseItem record) : IMusicInventory
    {
        public BaseItem Record => record;

        public bool Blocked;
        public (string Id, string[] Paths) Scope(BaseItem item) => ("", []);
        public BaseItem[] Records() => [record];
        public BaseItem Item(Guid id) => id == record.Id ? record : throw new ArgumentException("Missing fixture");
        public Dependencies Inspect(BaseItem item, string[] scope, Document? document = null) => new(item.Id, item.Name, item.Path, "MusicArtist", [], [], 0, 0, Blocked ? 1 : 0, [], [], [], "orphan candidate", true, !Blocked, [item.Path]);
        public void EnsureWritable(BaseItem item, string[] libraries, Document? document = null) => throw new NotSupportedException();
        public Guid[] Targets(MetadataPolicy policy, Document? document = null) => throw new NotSupportedException();
        public void RecoverMembership(Journal journal) => throw new NotSupportedException();
    }
}
