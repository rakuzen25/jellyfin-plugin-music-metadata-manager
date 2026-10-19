using System.Text.Json;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Providers;
using Jellyfin.Data.Enums;
using Microsoft.Extensions.Logging;

namespace MusicMetadataManager;
public sealed partial class Corrections
{
    (string Id, string[] Paths) Scope(BaseItem item)
    {
        var folders = library.GetVirtualFolders().Where(x => x.CollectionType?.ToString().Equals("music", StringComparison.OrdinalIgnoreCase) == true).SelectMany(x => x.Locations.Select(p => (Id: x.ItemId, Path: p))).Where(x => item.Path == x.Path || item.Path?.StartsWith(x.Path.TrimEnd('/') + "/", StringComparison.Ordinal) == true).OrderByDescending(x => x.Path.Length).ToArray();
        return folders.Length == 0 ? ("", []) : (folders[0].Id, [folders[0].Path]);
    }

    public BaseItem[] Items() => library.GetItemList(new InternalItemsQuery { Recursive = true, IncludeItemTypes = [BaseItemKind.Audio, BaseItemKind.MusicAlbum] }).Where(x => Scope(x).Id != "").OrderBy(x => x is MusicAlbum ? 1 : 0).ThenBy(x => x.Path, StringComparer.Ordinal).ToArray();
    public View Describe(BaseItem item)
    {
        var scope = Scope(item);
        var values = new Fields
        {
            Title = item.Name,
            Artists = (item is Audio a ? a.Artists : ((MusicAlbum)item).Artists).ToArray(),
            AlbumArtists = (item is Audio b ? b.AlbumArtists : ((MusicAlbum)item).AlbumArtists).ToArray()
        };
        if (item is Audio t)
        {
            values.Album = t.Album;
            values.DiscNumber = t.ParentIndexNumber;
            values.TrackNumber = t.IndexNumber;
        }

        var result = NativeMetadata.Read(item);
        foreach (var field in new[]
        {
            "title",
            "album",
            "artists",
            "albumArtists",
            "discNumber",
            "trackNumber"
        }

        )
            if (!result.ContainsKey(field))
                result[field] = JsonSerializer.SerializeToElement<object?>(null);
        return new()
        {
            Id = item.Id,
            Kind = item is Audio ? "track" : "album",
            Path = item.Path ?? "",
            Library = scope.Id,
            AlbumPath = item is Audio && library.GetItemById(item.ParentId)is MusicAlbum parent ? parent.Path ?? "" : "",
            LibraryPaths = scope.Paths,
            Locked = item.IsLocked,
            TitleLocked = item.LockedFields.Contains(MetadataField.Name),
            Values = result
        };
    }

    View Baseline(View actual, bool fresh = false)
    {
        var v = Codec.Clone(actual);
        if (State.Items.TryGetValue(v.Id, out var old))
            foreach (var p in old.Original)
                if (old.Applied.TryGetValue(p.Key, out var last) && actual.Values.TryGetValue(p.Key, out var current) && (!fresh || actual.Locked || actual.TitleLocked && p.Key == "title" || Engine.Equal(last, current)))
                    v.Values[p.Key] = p.Value;
        return v;
    }

    Plan Project(BaseItem item, View view, IEnumerable<Rule> rules, Dictionary<Guid, Plan>? plans = null)
    {
        var plan = Engine.Project(view, rules);
        if (item is MusicAlbum album && !plan.Values.ContainsKey("artists"))
        {
            var tracks = library.GetItemList(new InternalItemsQuery { ParentId = album.Id, Recursive = true, IncludeItemTypes = [BaseItemKind.Audio] }).OfType<Audio>().OrderBy(x => x.Path, StringComparer.Ordinal).ToArray();
            List<string> names = [];
            HashSet<string> ids = [];
            bool managed = false;
            foreach (var track in tracks)
            {
                var tv = Baseline(Describe(track));
                var tp = plans != null && plans.TryGetValue(track.Id, out var existing) ? existing : Engine.Project(tv, rules);
                var val = tp.Values.TryGetValue("artists", out var artists) ? artists : tv.Values["artists"];
                names.AddRange(val.Deserialize<string[]>() ?? []);
                if (tp.Values.ContainsKey("artists"))
                {
                    managed = true;
                    ids.UnionWith(tp.RuleIds);
                }
            }

            if (managed)
            {
                plan.Values["artists"] = JsonSerializer.SerializeToElement(names.Distinct(StringComparer.OrdinalIgnoreCase).ToArray());
                plan.RuleIds = plan.RuleIds.Concat(ids).Distinct().Order().ToArray();
            }
        }

        return plan;
    }

    Preview MakePreview(Document d)
    {
        List<Row> rows = [];
        HashSet<string> matched = [];
        Dictionary<Guid, Plan> plans = [];
        foreach (var item in Items())
        {
            var actual = Describe(item);
            var baseline = Baseline(actual);
            var plan = Project(item, baseline, d.Active, plans);
            plans[item.Id] = plan;
            matched.UnionWith(plan.RuleIds);
            State.Items.TryGetValue(item.Id, out var old);
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
            Metadata = MetadataPreview(d),
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
