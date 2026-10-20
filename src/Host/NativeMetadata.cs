using Jellyfin.Data.Enums;
using System.Text.Json;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Model.Entities;
using MediaBrowser.Controller.Library;

namespace MusicMetadataManager;
public static class NativeMetadata
{
    public static Dictionary<string, JsonElement> Read(BaseItem item)
    {
        Dictionary<string, object?> values = new()
        {
            ["title"] = item.Name,
            ["sortName"] = item.ForcedSortName,
            ["overview"] = item.Overview,
            ["genres"] = item.Genres,
            ["tags"] = item.Tags,
            ["country"] = item.ProductionLocations,
            ["premiereDate"] = item.PremiereDate?.ToString("yyyy-MM-dd"),
            ["endDate"] = item.EndDate?.ToString("yyyy-MM-dd"),
            ["productionYear"] = item.ProductionYear,
            ["providerIds"] = item.ProviderIds,
            ["lockedFields"] = item.LockedFields.Select(x => x.ToString()).ToArray(),
            ["isLocked"] = item.IsLocked
        };
        if (item is Audio t)
        {
            values["album"] = t.Album;
            values["artists"] = t.Artists;
            values["albumArtists"] = t.AlbumArtists;
            values["discNumber"] = t.ParentIndexNumber;
            values["trackNumber"] = t.IndexNumber;
        }
        else if (item is MusicAlbum a)
        {
            values["artists"] = a.Artists;
            values["albumArtists"] = a.AlbumArtists;
        }

        return values.ToDictionary(x => x.Key, x => JsonSerializer.SerializeToElement(x.Value, Codec.Json));
    }

    public static void Write(BaseItem item, string field, JsonElement value)
    {
        switch (field)
        {
            case "album":
                ((Audio)item).Album = value.Deserialize<string>();
                break;
            case "discNumber":
                item.ParentIndexNumber = value.Deserialize<int?>();
                break;
            case "trackNumber":
                item.IndexNumber = value.Deserialize<int?>();
                break;
            case "artists":
                if (item is Audio audio)
                    audio.Artists = value.Deserialize<string[]>() ?? [];
                else
                    ((MusicAlbum)item).Artists = value.Deserialize<string[]>() ?? [];
                break;
            case "albumArtists":
                if (item is Audio track)
                    track.AlbumArtists = value.Deserialize<string[]>() ?? [];
                else
                    ((MusicAlbum)item).AlbumArtists = value.Deserialize<string[]>() ?? [];
                break;
            case "title":
                item.Name = value.GetString()!;
                break;
            case "sortName":
                item.ForcedSortName = value.ValueKind == JsonValueKind.Null ? null : value.GetString();
                break;
            case "overview":
                item.Overview = value.ValueKind == JsonValueKind.Null ? null : value.GetString();
                break;
            case "genres":
                item.Genres = value.Deserialize<string[]>() ?? [];
                break;
            case "tags":
                item.Tags = value.Deserialize<string[]>() ?? [];
                break;
            case "country":
                item.ProductionLocations = value.Deserialize<string[]>() ?? [];
                break;
            case "productionYear":
                item.ProductionYear = value.Deserialize<int?>();
                break;
            case "premiereDate":
                item.PremiereDate = value.ValueKind == JsonValueKind.Null ? null : DateTime.SpecifyKind(DateOnly.ParseExact(value.GetString()!, "yyyy-MM-dd").ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);
                break;
            case "endDate":
                item.EndDate = value.ValueKind == JsonValueKind.Null ? null : DateTime.SpecifyKind(DateOnly.ParseExact(value.GetString()!, "yyyy-MM-dd").ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);
                break;
            case "providerIds":
                item.ProviderIds = value.Deserialize<Dictionary<string, string>>() ?? [];
                break;
            case "lockedFields":
                item.LockedFields = (value.Deserialize<string[]>() ?? []).Select(Enum.Parse<MetadataField>).ToArray();
                break;
            case "isLocked":
                item.IsLocked = value.GetBoolean();
                break;
            default:
                throw new ArgumentException("Unsupported native field: " + field);
        }
    }

    public static void EnsureArtistRecords(ILibraryManager library, BaseItem item)
    {
        var artists = item is Audio audio ? audio.Artists.Concat(audio.AlbumArtists) : ((MusicAlbum)item).Artists.Concat(((MusicAlbum)item).AlbumArtists);
        foreach (var name in artists.Distinct(StringComparer.OrdinalIgnoreCase))
            library.GetArtist(name);
    }

    public static async Task SaveCredits(ILibraryManager library, BaseItem item, CancellationToken token)
    {
        var artists = item is Audio audio ? audio.Artists : ((MusicAlbum)item).Artists;
        var albumArtists = item is Audio track ? track.AlbumArtists : ((MusicAlbum)item).AlbumArtists;
        var people = library.GetPeople(item).Where(x => x.Type != PersonKind.Artist && x.Type != PersonKind.AlbumArtist).ToList();
        people.AddRange(artists.Select(x => new PersonInfo { Name = x, Type = PersonKind.Artist }));
        people.AddRange(albumArtists.Select(x => new PersonInfo { Name = x, Type = PersonKind.AlbumArtist }));
        await library.UpdatePeopleAsync(item, people, token);
    }
}
