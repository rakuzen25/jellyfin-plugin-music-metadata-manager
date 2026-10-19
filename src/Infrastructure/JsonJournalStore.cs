using System.Text.Json;
namespace MusicMetadataManager;

/// <summary>The journal format and replacement ordering are preserved across upgrades.</summary>
public sealed class JsonJournalStore(IPluginStorage storage) : IJournalStore
{
    private string JournalPath => Path.Combine(storage.DirectoryPath, "state.json");
    public Journal Load() => File.Exists(JournalPath)
        ? JsonSerializer.Deserialize<Journal>(File.ReadAllText(JournalPath), Codec.Json)
            ?? throw new InvalidDataException("Empty correction journal.")
        : new();
    public void Save(Journal journal)
    {
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
