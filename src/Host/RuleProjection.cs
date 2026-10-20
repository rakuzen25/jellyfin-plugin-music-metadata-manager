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
public sealed class RuleProjection(ILibraryManager library, StateCoordinator state)
{
    SemaphoreSlim gate => state.Gate;

    Journal State => state.Journal;

    Document Doc => state.Document;

    void SaveState() => state.Commit();
    public (string Id, string[] Paths) Scope(BaseItem item)
    {
        var folders = library.GetVirtualFolders().Where(x => x.CollectionType?.ToString().Equals("music", StringComparison.OrdinalIgnoreCase) == true).SelectMany(x => x.Locations.Select(p => (Id: x.ItemId, Path: p))).Where(x => item.Path == x.Path || item.Path?.StartsWith(x.Path.TrimEnd('/') + "/", StringComparison.Ordinal) == true).OrderByDescending(x => x.Path.Length).ToArray();
        return folders.Length == 0 ? ("", []) : (folders[0].Id, [folders[0].Path]);
    }

    public BaseItem[] Items() => library.GetItemList(new InternalItemsQuery { Recursive = true, IncludeItemTypes = [BaseItemKind.Audio, BaseItemKind.MusicAlbum] }).Where(x => Scope(x).Id != "").OrderBy(x => x is MusicAlbum ? 1 : 0).ThenBy(x => x.Path, StringComparer.Ordinal).ToArray();
    public View Describe(BaseItem item)
    {
        var scope = Scope(item);
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

    public View Baseline(View actual, bool fresh = false) => FieldRestoration.Baseline(actual, State.Records.GetValueOrDefault(actual.Id), fresh);
    public Plan Project(BaseItem item, View view, IEnumerable<Rule> rules, Dictionary<Guid, Plan>? plans = null)
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
}
