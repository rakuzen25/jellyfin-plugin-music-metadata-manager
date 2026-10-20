using System.Text.Json.Serialization;

namespace MusicMetadataManager;
public sealed class PluginState
{
    [JsonRequired]
    public int SchemaVersion { get; set; } = DataFormat.Version;

    [JsonRequired]
    public Document Document { get; set; } = new();

    [JsonRequired]
    public Journal Journal { get; set; } = new();
}

public interface IStateStore
{
    PluginState Load();
    void Save(PluginState snapshot);
}

public interface IDocumentReader
{
    Document Current { get; }
}

/// <summary>One owner serializes state mutations. Readers receive detached documents.</summary>
public sealed class StateCoordinator(IStateStore store) : IDocumentReader
{
    private PluginState? working;
    private PluginState? committed;
    public SemaphoreSlim Gate { get; } = new(1, 1);

    private readonly object initialization = new();
    private PluginState Working
    {
        get
        {
            lock (initialization)
            {
                if (working is null)
                {
                    working = store.Load();
                    committed = Codec.Clone(working);
                }

                return working;
            }
        }
    }

    public Document Document => Working.Document;
    public Journal Journal => Working.Journal;
    public Document Current => Codec.Clone((Volatile.Read(ref committed) ?? Initialize()).Document);

    private PluginState Initialize()
    {
        _ = Working;
        return committed!;
    }

    public void Commit(Document? document = null)
    {
        var next = Codec.Clone(Working);
        if (document is not null)
            next.Document = Codec.Clone(document);
        try
        {
            store.Save(next);
        }
        catch
        {
            working = Codec.Clone(committed!);
            throw;
        }

        working = next;
        Volatile.Write(ref committed, Codec.Clone(next));
    }

    public void Rollback() => working = Codec.Clone(committed ?? Working);
}
