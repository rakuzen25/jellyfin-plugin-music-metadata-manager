using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Providers;

namespace MusicMetadataManager;
/// <summary>Jellyfin configuration and installed providers stay at this native boundary.</summary>
public interface ISourceLookup
{
    ArtistInfo Artist(MusicArtist artist);
    AlbumInfo Album(MusicAlbum album);
    IEnumerable<IRemoteMetadataProvider<MusicArtist, ArtistInfo>> Artists(MusicArtist artist, BaseItem source);
    IEnumerable<IRemoteMetadataProvider<MusicAlbum, AlbumInfo>> Albums(MusicAlbum album);
    Task<RemoteImageInfo[]> Images(BaseItem detached, string provider, CancellationToken token);
}

public sealed class SourceLookup(ILibraryManager library, IProviderManager providers, IFileSystem files) : ISourceLookup
{
    public ArtistInfo Artist(MusicArtist artist) => artist.GetLookupInfo();
    public AlbumInfo Album(MusicAlbum album) => album.GetLookupInfo();
    public IEnumerable<IRemoteMetadataProvider<MusicArtist, ArtistInfo>> Artists(MusicArtist artist, BaseItem source) => providers.GetMetadataProviders<MusicArtist>(artist, library.GetLibraryOptions(source), true).OfType<IRemoteMetadataProvider<MusicArtist, ArtistInfo>>();
    public IEnumerable<IRemoteMetadataProvider<MusicAlbum, AlbumInfo>> Albums(MusicAlbum album) => providers.GetMetadataProviders<MusicAlbum>(album, library.GetLibraryOptions(album), true).OfType<IRemoteMetadataProvider<MusicAlbum, AlbumInfo>>();
    public async Task<RemoteImageInfo[]> Images(BaseItem detached, string provider, CancellationToken token)
    {
        List<RemoteImageInfo> images = [];
        foreach (var source in providers.GetImageProviders(detached, new ImageRefreshOptions(new DirectoryService(files))).OfType<IRemoteImageProvider>().Where(x => x.Name == provider))
            images.AddRange(await source.GetImages(detached, token));
        return images.ToArray();
    }
}
