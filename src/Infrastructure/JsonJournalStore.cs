using System.Text.Json;
namespace MusicMetadataManager;

/// <summary>Atomically persist current-format correction state and pending work.</summary>
public sealed class JsonJournalStore(IPluginStorage storage) : IJournalStore
{
    private string JournalPath => Path.Combine(storage.DirectoryPath, "state.json");
    public Journal Load()
    {
        if (!File.Exists(JournalPath)) return new();
        var journal = JsonSerializer.Deserialize<Journal>(File.ReadAllText(JournalPath), Codec.Json)
            ?? throw new InvalidDataException("Empty correction journal.");
        if (journal.SchemaVersion != DataFormat.Version)
            throw new InvalidDataException("Unsupported journal schema version.");
        return journal;
    }
    public void Save(Journal journal)
    {
        if (journal.SchemaVersion != DataFormat.Version)
            throw new InvalidDataException("Unsupported journal schema version.");
        Directory.CreateDirectory(storage.DirectoryPath);
        var temporary = JournalPath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(journal, Codec.Json));
        File.Move(temporary, JournalPath, true);
    }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}

public sealed record PluginStorage(string DirectoryPath) : IPluginStorage;
