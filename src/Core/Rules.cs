using System.Text.Json;
using System.Text.Json.Serialization;
using System.Security.Cryptography;

namespace MusicMetadataManager;
public static class Codec
{
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        Converters =
        {
            new JsonStringEnumConverter()
        }
    };
    public static T Clone<T>(T value) => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value, Json), Json)!;
    public static string Hash<T>(T value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value, Json)));
}

/// <summary>A single decision map; typed accessors are views, never additional storage.</summary>
[JsonConverter(typeof(FieldMapConverter))]
public sealed class Fields
{
    public Dictionary<string, FieldDecision> Decisions { get; set; } = [];

    public Dictionary<string, JsonElement> Values() => MetadataEngine.Values(Decisions);
    private T? Read<T>(string name)
    {
        if (Decisions is null || !Decisions.TryGetValue(name, out var decision) || decision is null || decision.Mode != "approved")
            return default;
        try
        {
            return decision.Value.Deserialize<T>();
        }
        catch (JsonException)
        {
            return default;
        }
    }

    private void Write<T>(string name, T? value)
    {
        if (value is null)
            Decisions.Remove(name);
        else
            Decisions[name] = new()
            {
                Value = JsonSerializer.SerializeToElement(value, Codec.Json)
            };
    }

    [JsonIgnore]
    public string? Title { get => Read<string>("title"); set => Write("title", value); }

    [JsonIgnore]
    public string? Album { get => Read<string>("album"); set => Write("album", value); }

    [JsonIgnore]
    public string[]? Artists { get => Read<string[]>("artists"); set => Write("artists", value); }

    [JsonIgnore]
    public string[]? AlbumArtists { get => Read<string[]>("albumArtists"); set => Write("albumArtists", value); }

    [JsonIgnore]
    public int? DiscNumber { get => Read<int?>("discNumber"); set => Write("discNumber", value); }

    [JsonIgnore]
    public int? TrackNumber { get => Read<int?>("trackNumber"); set => Write("trackNumber", value); }
}

public sealed class Rule
{
    public MetadataPolicy? Metadata { get; set; }
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Label { get; set; } = "";
    public string Kind { get; set; } = "track";
    public string Path { get; set; } = "";
    public string Credit { get; set; } = "";
    public string[] Names { get; set; } = [];
    public string Role { get; set; } = "artists";
    public string[] Libraries { get; set; } = [];
    public Fields Fields { get; set; } = new();
    public Fields TrackDefaults { get; set; } = new();
}

public sealed class Document
{
    [JsonRequired]
    public int SchemaVersion { get; set; } = DataFormat.Version;
    public long Revision { get; set; }

    [JsonRequired]
    public List<Rule> Active { get; set; } = [];

    [JsonRequired]
    public List<Rule> Drafts { get; set; } = [];

    [JsonRequired]
    public List<MetadataPolicy> Policies { get; set; } = [];

    [JsonRequired]
    public List<MetadataPolicy> PolicyDrafts { get; set; } = [];

    [JsonRequired]
    public List<ArtistIdentity> Identities { get; set; } = [];

    [JsonRequired]
    public List<ArtistIdentity> IdentityDrafts { get; set; } = [];
}

public sealed class View
{
    public Guid Id { get; set; }
    public string Path { get; set; } = "";
    public string Kind { get; set; } = "track";
    public string Library { get; set; } = "";
    public string AlbumPath { get; set; } = "";
    public string[] LibraryPaths { get; set; } = [];
    public bool Locked { get; set; }
    public bool TitleLocked { get; set; }
    public Dictionary<string, JsonElement> Values { get; set; } = [];
}

public sealed class Plan
{
    public Dictionary<string, JsonElement> Values { get; set; } = [];
    public string[] RuleIds { get; set; } = [];
}

public static class Engine
{
    public static bool Equal(JsonElement a, JsonElement b) => JsonElement.DeepEquals(a, b);
    public static bool InScope(Rule r, View v) => r.Libraries.Contains(v.Library, StringComparer.Ordinal);
    public static List<string> Validate(IEnumerable<Rule> input)
    {
        var rules = input.ToArray();
        List<string> errors = [];
        if (rules.Any(r => r is null || r.Fields is null || r.TrackDefaults is null || r.Libraries is null || r.Names is null || r.Path is null || r.Credit is null))
            return["Rules and their fields, names, paths and library selections must not be null."];
        if (rules.Any(r => r.Metadata is { } m && (m.Images is null || m.Bindings is null || m.Snapshots is null || m.Fields is null)))
            return["Metadata rule lists must not be null."];
        foreach (var fields in rules.SelectMany(r => new[] { r.Fields, r.TrackDefaults }))
            errors.AddRange(MetadataEngine.ValidateFields(fields.Decisions));
        if (errors.Count > 0)
            return errors;
        foreach (var r in rules)
        {
            if (r.Metadata is { } metadata)
                errors.AddRange(MetadataEngine.ValidatePolicies([metadata]));
            if (!Guid.TryParse(r.Id, out _))
                errors.Add("Rule IDs must be GUIDs.");
            if (r.Libraries.Length == 0 || r.Libraries.Any(string.IsNullOrWhiteSpace) || r.Libraries.Distinct().Count() != r.Libraries.Length)
                errors.Add($"{r.Id}: select distinct music libraries.");
            if (r.Kind is not ("track" or "album" or "alias"))
                errors.Add($"{r.Id}: unknown rule kind.");
            if (r.Kind != "alias" && (!r.Path.StartsWith('/') || r.Path.Contains("/../") || r.Path.EndsWith("/..") || r.Path.Contains("//") || r.Path.EndsWith('/')))
                errors.Add($"{r.Id}: use an exact absolute file or folder path without trailing slash.");
            if (r.Kind == "alias" && (string.IsNullOrWhiteSpace(r.Credit) || r.Names.Length == 0 || r.Names.Any(string.IsNullOrWhiteSpace) || r.Names.Distinct(StringComparer.OrdinalIgnoreCase).Count() != r.Names.Length || r.Role is not ("artists" or "albumArtists" or "both")))
                errors.Add($"{r.Id}: invalid credit mapping.");
            if (r.Kind == "album" && (r.Fields.Album != null || r.Fields.DiscNumber != null || r.Fields.TrackNumber != null || r.Fields.Values().Keys.Any(k => k is "album" or "discNumber" or "trackNumber")))
                errors.Add($"{r.Id}: album fields support title, artists and albumArtists only; use trackDefaults for tracks.");
            if (r.Kind != "album" && r.TrackDefaults.Values().Count > 0)
                errors.Add($"{r.Id}: trackDefaults are only allowed for album rules.");
            if (r.Kind == "alias" && r.Fields.Values().Count > 0)
                errors.Add($"{r.Id}: aliases use names and role, not fields.");
            if (r.Kind != "alias" && r.Fields.Values().Count == 0 && r.TrackDefaults.Values().Count == 0 && (r.Metadata is null || r.Metadata.Images.Count == 0 && r.Metadata.Bindings.Count == 0 && !r.Fields.Decisions.Values.Any(f => f.Mode == "unmanaged")))
                errors.Add($"{r.Id}: specify at least one field.");
        }

        if (rules.Select(x => x.Id).Distinct().Count() != rules.Length)
            errors.Add("Duplicate rule IDs.");
        foreach (var conflict in Conflicts(rules))
            errors.Add($"Conflicting rules: {conflict[0]} and {conflict[1]}.");
        return errors;
    }

    public static string[][] Conflicts(IEnumerable<Rule> input)
    {
        var rules = input.ToArray();
        List<string[]> conflicts = [];
        for (int i = 0; i < rules.Length; i++)
            for (int j = i + 1; j < rules.Length; j++)
            {
                var a = rules[i];
                var b = rules[j];
                if (a is null || b is null || a.Libraries is null || b.Libraries is null || a.Fields is null || b.Fields is null || a.TrackDefaults is null || b.TrackDefaults is null || a.Fields.Decisions is null || b.Fields.Decisions is null || a.TrackDefaults.Decisions is null || b.TrackDefaults.Decisions is null)
                    continue;
                if (a.Kind != b.Kind || !a.Libraries.Intersect(b.Libraries).Any())
                    continue;
                bool conflict = a.Kind == "alias" ? a.Credit == b.Credit && (a.Role == b.Role || a.Role == "both" || b.Role == "both") : a.Path == b.Path && (a.Fields.Values().Keys.Intersect(b.Fields.Values().Keys).Any() || a.TrackDefaults.Values().Keys.Intersect(b.TrackDefaults.Values().Keys).Any() || a.Kind == "album" && (a.Fields.Title != null && b.TrackDefaults.Album != null || b.Fields.Title != null && a.TrackDefaults.Album != null));
                if (conflict)
                    conflicts.Add([a.Id, b.Id]);
            }

        return conflicts.ToArray();
    }

    public static Plan Project(View v, IEnumerable<Rule> input)
    {
        var rules = input.Where(r => InScope(r, v)).ToArray();
        Dictionary<string, JsonElement> values = [];
        HashSet<string> ids = [];
        foreach (var field in new[]
        {
            "artists",
            "albumArtists"
        }

        )
            if (v.Values.TryGetValue(field, out var raw))
            {
                var names = raw.Deserialize<string[]>() ?? [];
                List<string> next = [];
                bool managed = false;
                foreach (var name in names)
                {
                    var r = rules.FirstOrDefault(r => r.Kind == "alias" && r.Credit == name && (r.Role == field || r.Role == "both"));
                    if (r != null)
                    {
                        next.AddRange(r.Names);
                        ids.Add(r.Id);
                        managed = true;
                    }
                    else
                        next.Add(name);
                }

                if (managed)
                    values[field] = JsonSerializer.SerializeToElement(next.Distinct(StringComparer.OrdinalIgnoreCase).ToArray());
            }

        foreach (var r in rules.Where(r => r.Kind == "album" && (v.Path == r.Path || v.Kind == "track" && (v.AlbumPath == r.Path || Path.GetDirectoryName(v.Path) == r.Path))))
        {
            var f = v.Kind == "album" ? r.Fields.Values() : r.TrackDefaults.Values();
            if (v.Kind == "track" && r.Fields.Title != null && !f.ContainsKey("album"))
                f["album"] = JsonSerializer.SerializeToElement(r.Fields.Title);
            foreach (var p in f)
                values[p.Key] = p.Value;
            if (f.Count > 0)
                ids.Add(r.Id);
        }

        foreach (var r in rules.Where(r => r.Kind == "track" && v.Kind == "track" && v.Path == r.Path))
        {
            foreach (var p in r.Fields.Values())
                values[p.Key] = p.Value;
            ids.Add(r.Id);
        }

        return new()
        {
            Values = values,
            RuleIds = ids.Order().ToArray()
        };
    }
}
