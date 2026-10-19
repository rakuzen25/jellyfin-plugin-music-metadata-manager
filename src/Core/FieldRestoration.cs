using System.Text.Json;

namespace MusicMetadataManager;
public static class FieldRestoration
{
    public static View Baseline(View actual, ManagedRecord? record, bool fresh = false)
    {
        var baseline = Codec.Clone(actual);
        if (record is not null)
            foreach (var pair in record.Original)
                if (record.Applied.TryGetValue(pair.Key, out var applied) && actual.Values.TryGetValue(pair.Key, out var current) && (!fresh || actual.Locked || actual.TitleLocked && pair.Key == "title" || Engine.Equal(applied, current)))
                    baseline.Values[pair.Key] = pair.Value;
        return baseline;
    }

    public static JsonElement Release(View actual, ManagedRecord prior, string field) => Engine.Equal(actual.Values[field], prior.Applied[field]) || actual.Locked || actual.TitleLocked && field == "title" ? prior.Original[field] : actual.Values[field];
}
