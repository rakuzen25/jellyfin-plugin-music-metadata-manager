namespace MusicMetadataManager;
public interface ILibraryCatalog
{
    string[] LibraryIds();
}

public interface IIdentityBindings
{
    void Validate(ArtistIdentity identity);
}

public interface IMetadataPolicyEditor
{
    void PutPolicy(Document document, MetadataPolicy policy, bool draft = false);
    void CandidateMetadata(Document document, Change change);
    void ValidateMetadata(Document document);
}

public interface IReviewProjection
{
    Preview MakePreview(Document document);
}

public interface IRestorationService
{
    RestorationPreview[] RelinquishPreview(Change change, Document document);
    Guid[] CommitMetadata(Document document, Change change);
}

public interface IReviewedCleanup
{
    CleanupReview[] CleanupPreview(Guid[] ids, Document document);
    Dictionary<Guid, string> Fingerprints(Guid[] ids, CleanupReview[] rows);
    CleanupOutcome[] DeleteOrphans(Guid[] ids, Document document, Dictionary<Guid, string>? fingerprints = null);
}
