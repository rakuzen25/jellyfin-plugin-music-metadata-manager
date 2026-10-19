using System.Collections;
using System.Reflection;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging.Abstractions;
using MusicMetadataManager;
using Xunit;

namespace MusicMetadataManager.Tests;
public sealed class NativeCorrectionTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FailedOrCancelledNativeWriteRetainsOriginalAndPendingWorkForRestart(bool cancel)
    {
        using var fixture = new Fixture();
        fixture.Library.Fail = true;
        fixture.Library.Cancel = cancel;
        var failure = await Xunit.Record.ExceptionAsync(() => fixture.Writer.Correct(fixture.Library.Track, true, TestContext.Current.CancellationToken));
        Assert.True(cancel ? failure is OperationCanceledException : failure is IOException);
        var saved = fixture.Store.Load();
        Assert.Equal("Original", saved.Journal.Records[fixture.Id].Original["title"].GetString());
        Assert.Contains(fixture.Id, saved.Journal.Pending.Keys);
        fixture.Library.Track.Name = "Original";
        fixture.Library.Fail = false;
        fixture.Restart();
        await fixture.Writer.Correct(fixture.Library.Track, true, TestContext.Current.CancellationToken);
        Assert.Equal("Reviewed", fixture.Library.Track.Name);
        Assert.Empty(fixture.Store.Load().Journal.Pending);
        Assert.Equal("Original", fixture.Store.Load().Journal.Records[fixture.Id].Original["title"].GetString());
    }

    private sealed class Fixture : IDisposable
    {
        public Guid Id => Library.Track.Id;
        public NativeLibrary Library { get; }

        private readonly string directory = Path.Combine(Path.GetTempPath(), "native-correction-" + Guid.NewGuid());
        public JsonStateStore Store { get; }
        public CorrectionWriter Writer { get; private set; } = null!;

        private readonly ILibraryManager native;
        public Fixture()
        {
            native = DispatchProxy.Create<ILibraryManager, NativeLibrary>();
            Library = (NativeLibrary)(object)native;
            Store = new(new PluginStorage(directory));
            var state = new StateCoordinator(Store);
            state.Commit(new() { Active = [new() { Path = Library.Track.Path!, Libraries = ["fixture-library"], Fields = new() { Title = "Reviewed" } }] });
            Restart();
        }

        public void Restart()
        {
            var state = new StateCoordinator(Store);
            var projection = new RuleProjection(native, state);
            var policies = new MetadataPolicies(native, null!, null!, state, projection);
            var metadata = new MetadataReconciler(native, null!, null!, null!, state, policies, new Clock());
            Writer = new(native, null!, NullLogger<CorrectionWriter>.Instance, state, projection, metadata, new ReconciliationService(state));
        }

        public void Dispose()
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, true);
        }
    }

    private sealed class Clock : IClock
    {
        public DateTime UtcNow => new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    }
}

public class NativeLibrary : DispatchProxy
{
    public Audio Track { get; } = new()
    {
        Id = Guid.NewGuid(),
        Name = "Original",
        Path = "/fixture-media/track.flac",
        Artists = ["Artist"],
        AlbumArtists = ["Album artist"]
    };
    public BaseItem? Other { get; set; }

    public bool Fail, Cancel;
    public int Deletes;
    protected override object? Invoke(MethodInfo? method, object? []? args)
    {
        ArgumentNullException.ThrowIfNull(method);
        if (method.Name == "GetVirtualFolders")
        {
            var element = method.ReturnType.GetGenericArguments()[0];
            var list = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(element))!;
            var folder = Activator.CreateInstance(element)!;
            element.GetProperty("ItemId")!.SetValue(folder, "fixture-library");
            element.GetProperty("Name")!.SetValue(folder, "Fixture");
            element.GetProperty("Locations")!.SetValue(folder, new[] { "/fixture-media" });
            var type = element.GetProperty("CollectionType")!;
            type.SetValue(folder, Enum.Parse(Nullable.GetUnderlyingType(type.PropertyType) ?? type.PropertyType, "music", true));
            list.Add(folder);
            return list;
        }

        if (method.Name == "RetrieveItem")
            return Track;
        if (method.Name == "GetItemById")
            return args![0] is Guid id && id == Track.Id ? Track : Other;
        if (method.Name == "UpdateItemAsync")
            return Fail ? (Cancel ? Task.FromCanceled(new CancellationToken(true)) : Task.FromException(new IOException("Synthetic native save failure"))) : Task.CompletedTask;
        if (method.Name == "DeleteItem")
        {
            Deletes++;
            Other = null;
            return null;
        }

        throw new InvalidOperationException("Unexpected native access: " + method.Name);
    }
}
