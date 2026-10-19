using MediaBrowser.Controller.Entities;

namespace MusicMetadataManager;
/// <summary>Native inventory evidence; decisions and workflows do not depend on EF queries.</summary>
public interface IMusicInventory
{
    (string Id, string[] Paths) Scope(BaseItem item);
    BaseItem[] Records();
    BaseItem Item(Guid id);
    Dependencies Inspect(BaseItem item, string[] scope, Document? document = null);
    void EnsureWritable(BaseItem item, string[] libraries, Document? document = null);
    Guid[] Targets(MetadataPolicy policy, Document? document = null);
    void RecoverMembership(Journal journal);
}
