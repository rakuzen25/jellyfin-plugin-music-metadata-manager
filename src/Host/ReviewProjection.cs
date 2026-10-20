using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Providers;
using MediaBrowser.Controller.Dto;
using Jellyfin.Data.Enums;
using Microsoft.Extensions.Logging;

namespace MusicMetadataManager;
public sealed class ReviewProjection(ILibraryManager library, StateCoordinator state, RuleProjection projection, MetadataPolicies policies) : IReviewProjection
{
    SemaphoreSlim gate => state.Gate;

    Journal State => state.Journal;

    Document Doc => state.Document;

    void SaveState() => state.Commit();
    public Preview MakePreview(Document d)
    {
        List<Row> rows = [];
        HashSet<string> matched = [];
        Dictionary<Guid, Plan> plans = [];
        foreach (var item in projection.Items())
        {
            var actual = projection.Describe(item);
            var baseline = projection.Baseline(actual);
            var plan = projection.Project(item, baseline, d.Active, plans);
            plans[item.Id] = plan;
            matched.UnionWith(plan.RuleIds);
            State.Records.TryGetValue(item.Id, out var old);
            var released = old?.Applied.Keys.Except(plan.Values.Keys).ToArray() ?? [];
            if (plan.Values.Count == 0 && released.Length == 0)
                continue;
            var before = new Dictionary<string, JsonElement>();
            var after = new Dictionary<string, JsonElement>();
            foreach (var key in plan.Values.Keys.Concat(released).Distinct())
            {
                before[key] = actual.Values[key];
                after[key] = plan.Values.TryGetValue(key, out var target) ? target : old!.Original[key];
            }

            rows.Add(new() { Id = item.Id, Path = actual.Path, Kind = actual.Kind, Locked = actual.Locked || actual.TitleLocked && after.ContainsKey("title"), RuleIds = plan.RuleIds, Before = before, After = after, ChangedFields = after.Where(x => !Engine.Equal(before[x.Key], x.Value)).Select(x => x.Key).ToArray(), ReleasedFields = released });
        }

        return new()
        {
            Revision = Doc.Revision,
            Identities = AliasService.Reports(library, d.Identities),
            Metadata = policies.MetadataPreview(d),
            Items = rows,
            UnmatchedRules = d.Active.Where(x => !matched.Contains(x.Id)).Select(x => x.Id).ToArray(),
            Warnings = (rows.Any(x => x.ReleasedFields.Length > 0) ? new[]
            {
                "Removing managed fields refreshes affected items through Jellyfin providers. Preview shows recorded prior values; current provider results may differ. Locked fields use recorded values."
            }

            : Array.Empty<string>()).Concat(rows.Any(x => x.ChangedFields.Any(f => f is "title" or "album" or "artists" or "albumArtists" or "providerIds")) ? new[] { "Changes to release titles, credits or provider IDs may alter scrobbling payloads. Review them explicitly." } : Array.Empty<string>()).ToArray()
        };
    }
}
