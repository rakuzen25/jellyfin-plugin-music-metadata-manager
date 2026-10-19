using System.Text;

namespace MusicMetadataManager;
public sealed class ArtistIdentity
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string PreferredName { get; set; } = "";
    public string[] Aliases { get; set; } = [];
    public string[] Libraries { get; set; } = [];
    public Guid ArtistId { get; set; }
    public Guid PersonId { get; set; }
    public Guid[] ArtistIds { get; set; } = [];
    public Guid[] PersonIds { get; set; } = [];
    public string? MusicBrainzId { get; set; }

    [System.Text.Json.Serialization.JsonIgnore]
    public IEnumerable<string> Names => Aliases.Append(PreferredName);

    [System.Text.Json.Serialization.JsonIgnore]
    public Guid[] Records => ArtistIds.Concat(PersonIds).Append(ArtistId).Append(PersonId).Where(x => x != Guid.Empty).Distinct().ToArray();
}

public static class IdentityEngine
{
    public static string Key(string name) => name.Normalize(NormalizationForm.FormC).ToUpperInvariant();
    public static bool Matches(ArtistIdentity identity, string credit) => identity.Names.Any(x => Key(x) == Key(credit));
    public static int SearchScore(ArtistIdentity identity, string term) => identity.Names.Select(name =>
    {
        var n = Key(name);
        var q = Key(term);
        return n == q ? 100 : n.StartsWith(q, StringComparison.Ordinal) ? 80 : n.Contains(q, StringComparison.Ordinal) ? 50 : 0;
    }).Max();
    public static List<string> Validate(IEnumerable<ArtistIdentity> input)
    {
        var rows = input.ToArray();
        List<string> errors = [];
        foreach (var r in rows)
        {
            if (r is null)
            {
                errors.Add("Identity must not be null.");
                continue;
            }

            if (!Guid.TryParse(r.Id, out _) || string.IsNullOrWhiteSpace(r.PreferredName) || r.Aliases is null || r.Aliases.Any(string.IsNullOrWhiteSpace) || r.Libraries is null || r.Libraries.Length == 0 || r.Libraries.Any(string.IsNullOrWhiteSpace) || r.ArtistIds is null || r.PersonIds is null || r.ArtistId == Guid.Empty || r.PersonId == Guid.Empty || r.MusicBrainzId is not null && !Guid.TryParse(r.MusicBrainzId, out _))
                errors.Add($"{r.Id}: invalid identity; choose a name, libraries, and both representatives.");
        }

        if (errors.Count > 0)
            return errors;
        if (rows.Select(r => r.Id).Distinct().Count() != rows.Length)
            errors.Add("Duplicate identity IDs.");
        for (int i = 0; i < rows.Length; i++)
            for (int j = i + 1; j < rows.Length; j++)
            {
                var a = rows[i];
                var b = rows[j];
                if (a.Libraries.Intersect(b.Libraries).Any() && (a.Names.Select(Key).Intersect(b.Names.Select(Key)).Any() || a.Records.Intersect(b.Records).Any()))
                    errors.Add($"Conflicting artist identities: {a.PreferredName} and {b.PreferredName}.");
            }

        return errors;
    }
}
