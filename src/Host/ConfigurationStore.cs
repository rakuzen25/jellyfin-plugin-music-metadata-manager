namespace MusicMetadataManager;

/// <summary>Jellyfin configuration persistence stays at the host boundary.</summary>
public sealed class ConfigurationStore(Plugin plugin) : IConfigurationStore
{
    public Document Current => plugin.Configuration.Rules;
    public void Save(Document document)
    {
        var previous = Current;
        document.SchemaVersion = 3;
        plugin.Configuration.Rules = document;
        try { plugin.SaveConfiguration(); }
        catch { plugin.Configuration.Rules = previous; throw; }
    }
}
