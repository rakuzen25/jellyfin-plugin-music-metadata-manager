namespace MusicMetadataManager;
public sealed record FieldDefinition(string Name, string Kind, bool Required, bool Core, bool Advanced, string[] Targets);
public static class FieldCatalog
{
    private static readonly string[] All = ["track", "album", "artist"];
    private static readonly string[] Music = ["track", "album"];
    private static readonly string[] Track = ["track"];
    public static IReadOnlyList<FieldDefinition> Definitions { get; } = Array.AsReadOnly(new FieldDefinition[] { new("title", "text", true, true, false, All), new("album", "text", true, true, false, Track), new("artists", "names", true, true, false, Music), new("albumArtists", "names", true, true, false, Music), new("discNumber", "number", true, true, false, Track), new("trackNumber", "number", true, true, false, Track), new("sortName", "text", false, false, false, All), new("overview", "text", false, false, false, All), new("genres", "names", false, false, false, All), new("tags", "names", false, false, false, All), new("premiereDate", "date", false, false, false, All), new("endDate", "date", false, false, false, All), new("productionYear", "number", false, false, false, All), new("country", "names", false, false, false, All), new("providerIds", "map", false, false, true, All), new("lockedFields", "names", false, false, true, All), new("isLocked", "boolean", true, false, true, All), });

    public static FieldDefinition? Find(string name) => Definitions.FirstOrDefault(x => x.Name == name);
}
