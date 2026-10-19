namespace MusicMetadataManager;
public static class DocumentValidation
{
    public static void EnsureShape(Document document)
    {
        if (document is null || document.SchemaVersion != DataFormat.Version)
            throw new ArgumentException("Unsupported rules schema version.");
        if (document.Active is null || document.Drafts is null || document.Policies is null || document.PolicyDrafts is null || document.Identities is null || document.IdentityDrafts is null)
            throw new ArgumentException("Document lists must not be null.");
        if (document.Active.Concat(document.Drafts).Any(x => x is null) || document.Policies.Concat(document.PolicyDrafts).Any(x => x is null) || document.Identities.Concat(document.IdentityDrafts).Any(x => x is null))
            throw new ArgumentException("Document lists must not contain null entries.");
    }
}
