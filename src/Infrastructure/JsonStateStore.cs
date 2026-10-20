using System.Text.Json;

namespace MusicMetadataManager;
/// <summary>Rules, restoration baselines and admitted work have one commit point.</summary>
public sealed class JsonStateStore(IPluginStorage storage) : IStateStore
{
    private string StatePath => Path.Combine(storage.DirectoryPath, "state.json");

    public PluginState Load()
    {
        if (!File.Exists(StatePath))
            return new();
        var snapshot = JsonSerializer.Deserialize<PluginState>(File.ReadAllBytes(StatePath), Codec.Json) ?? throw new InvalidDataException("Empty plugin state.");
        Validate(snapshot);
        return snapshot;
    }

    public void Save(PluginState snapshot)
    {
        Validate(snapshot);
        AtomicJson.Write(StatePath, snapshot);
    }

    private static void Validate(PluginState snapshot)
    {
        if (snapshot.SchemaVersion != DataFormat.Version || snapshot.Document is null || snapshot.Journal is null || snapshot.Document.SchemaVersion != DataFormat.Version || snapshot.Journal.SchemaVersion != DataFormat.Version)
            throw new InvalidDataException("Unsupported or incomplete plugin state.");
        if (snapshot.Journal.CleanupPending is null || snapshot.Journal.Records is null || snapshot.Journal.Pending is null || snapshot.Journal.Reports is null || snapshot.Journal.Restores is null || snapshot.Journal.IdentityNames is null || snapshot.Journal.History is null || snapshot.Journal.DeletedRecords is null)
            throw new InvalidDataException("Plugin state collections must not be null.");
        DocumentValidation.EnsureShape(snapshot.Document);
    }
}

public static class AtomicJson
{
    public static void Write<T>(string path, T value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(stream, value, Codec.Json);
                stream.Flush(flushToDisk: true);
            }

            File.Move(temporary, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary))
                File.Delete(temporary);
        }
    }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}

public sealed record PluginStorage(string DirectoryPath) : IPluginStorage;
