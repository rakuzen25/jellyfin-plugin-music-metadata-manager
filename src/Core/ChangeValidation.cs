namespace MusicMetadataManager;
public static class ChangeValidation
{
    public static void EnsureShape(Change change)
    {
        ArgumentNullException.ThrowIfNull(change);
        if (change.Edits is null || change.ActivateIds is null || change.DisableIds is null || change.DeleteIds is null || change.IdentityEdits is null || change.ActivateIdentities is null || change.DisableIdentities is null || change.DeleteIdentities is null || change.MetadataEdits is null || change.ActivatePolicies is null || change.DisablePolicies is null || change.DeletePolicies is null || change.Relinquish is null || change.CleanupIds is null)
            throw new ArgumentException("Change lists must not be null.");
        if (change.Edits.Any(x => x is null || x.Fields is null || x.TrackDefaults is null || x.Libraries is null || x.Fields.Decisions is null || x.TrackDefaults.Decisions is null) || change.MetadataEdits.Any(x => x is null || x.Fields is null || x.Images is null || x.Libraries is null || x.Bindings is null || x.Snapshots is null) || change.IdentityEdits.Any(x => x is null || x.Libraries is null || x.Aliases is null || x.ArtistIds is null || x.PersonIds is null) || change.Relinquish.Any(x => x is null || x.Fields is null || x.Images is null))
            throw new ArgumentException("Change entries and their collections must not be null.");
    }
}

public sealed class OperationRejectedException(string code, string message) : ArgumentException(message)
{
    public string Code { get; } = code;
}
