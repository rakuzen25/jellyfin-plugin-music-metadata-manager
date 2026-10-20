using MediaBrowser.Controller.Library;

namespace MusicMetadataManager;
public sealed class LibraryCatalog(ILibraryManager library) : ILibraryCatalog
{
    public string[] LibraryIds() => library.GetVirtualFolders().Where(x => x.CollectionType?.ToString().Equals("music", StringComparison.OrdinalIgnoreCase) == true).Select(x => x.ItemId).ToArray();
}

public sealed class IdentityBindings(ILibraryManager library) : IIdentityBindings
{
    public void Validate(ArtistIdentity identity) => AliasService.ValidateBindings(library, identity);
}
