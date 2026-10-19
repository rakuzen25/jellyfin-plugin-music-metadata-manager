namespace MusicMetadataManager;

/// <summary>Jellyfin configuration persistence stays at the host boundary.</summary>
public sealed class ConfigurationStore(Plugin plugin) : IConfigurationStore
{
    public Document Current
    {
        get
        {
            var document = plugin.Configuration.Rules;
            if (document.SchemaVersion != DataFormat.Version)
                throw new InvalidDataException("Unsupported rules schema version.");
            return document;
        }
    }
    public void Save(Document document)
    {
        var previous = Current;
        if (document.SchemaVersion != DataFormat.Version)
            throw new ArgumentException("Unsupported rules schema version.");
        plugin.Configuration.Rules = document;
        try { plugin.SaveConfiguration(); }
        catch { plugin.Configuration.Rules = previous; throw; }
    }
}
