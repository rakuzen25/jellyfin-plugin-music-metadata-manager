using System.Text.Json;

namespace MusicMetadataManager;
public sealed record LibraryInfo(string Id, string Name, string[] Paths);
public sealed record ActivationResult(CleanupOutcome[] CleanupResults, long Revision, int Queued);
public sealed record DiscardResult(DraftTarget[] Discarded, long Revision);
public sealed record AcknowledgmentResult(string[] Acknowledged);
public sealed record QueueResult(int Queued);
public sealed record SaveResult(string Saved);
public sealed record DeleteResult(string Deleted);
public sealed record ImportResult(bool Imported);
public sealed record ValidationResult(string[] Errors);
public sealed record ApiError(string Code, string Error, string[]? RuleIds = null);
public sealed record IdentityBindingInfo(Guid Id, string? Name, string? Type);
public sealed record IdentityAffectedItem(Guid Id, string? Path, string Kind, string[] CreditedNames, Guid LinkTarget);
public sealed record IdentityReport(string Id, string Name, string[] Aliases, string[] Libraries, IdentityBindingInfo[] Bindings, IdentityAffectedItem[] AffectedItems, Guid[] Missing, string[] MissingLibraries, string FavoritePolicy, string Credits, string Scrobbling);
public sealed record StoredImage(string Path, string? Hash);
public sealed class MetadataPreviewRow
{
    public Guid Id { get; init; }
    public string PolicyId { get; init; } = "";
    public string? IdentityId { get; init; }
    public string? Error { get; init; }
    public string Name { get; init; } = "";
    public string Kind { get; init; } = "";
    public Dictionary<string, JsonElement> Before { get; init; } = [];
    public Dictionary<string, JsonElement> After { get; init; } = [];
    public Dictionary<string, ImageDecision> Images { get; init; } = [];
    public Dictionary<string, StoredImage[]> StoredImages { get; init; } = [];
    public string[] Locks { get; init; } = [];
    public bool IsLocked { get; init; }
    public Dependencies? Dependencies { get; init; }
    public List<SourceSnapshot> Sources { get; init; } = [];
    public bool ScrobblingRelevant { get; init; }
}

public sealed record RestorationPreview(Guid Id, string Name, string Operation, Dictionary<string, JsonElement> Before, Dictionary<string, JsonElement> After, Dictionary<string, ImageDecision> OriginalImages, string[] Fields, string[] ImageTypes);
public sealed record FileFingerprint(string Path, string Hash);
public sealed record CleanupReview(Guid Id, string Name, Dependencies Dependencies, bool RemovesInternalMetadataAndArtwork, bool SourceFilesDeleted, FileFingerprint[] Files);
public sealed record NavigationDestination(Guid Id, string Name);
public sealed record NavigationResponse(Dictionary<string, NavigationDestination?> Items, Dictionary<string, NavigationDestination?> Rules, Dictionary<string, NavigationDestination?> Paths);
public sealed record CanonicalIdentityInfo(string Id, string Name, string[] Aliases, Guid[] Records, string[] Libraries);
public sealed record IdentityMembership(string Id, string Name, bool Representative);
public sealed record InventoryPage(int Total, int Start, int Limit, InventoryEntry[] Items, string View, CanonicalIdentityInfo[]? CanonicalIdentities = null);
public sealed record TrackSummary(Guid Id, string Name, int? DiscNumber, int? TrackNumber, string[] Artists, string? Path, bool Managed);
public sealed record AlbumTracksResponse(Guid AlbumId, int Total, TrackSummary[] Items);
public sealed record ProviderCandidate(string Key, string RecordId, bool Confirmed);
public sealed record SourceProviderInfo(string Name, string? Key);
public sealed record NativeImageInfo(string Type, string Path);
public sealed record ManagerDetailsResponse(Guid Id, string Name, string Kind, string? Path, Dictionary<string, JsonElement> Stored, Dictionary<string, JsonElement> Effective, MetadataPolicy Policy, MetadataPolicy[] Policies, MetadataPolicy[] Drafts, Dependencies Dependencies, ProviderCandidate[] ProviderCandidates, SourceProviderInfo[] Providers, string[] Locks, bool IsLocked, ManagedRecord? Original, ManagedRecord? CorrectionOriginal, NativeImageInfo[] Images, HistoryEntry[] History, string RefreshBehavior);
public sealed record StatusResponse(long Revision, int Active, int Drafts, int Identities, int IdentityDrafts, IdentityReport[] IdentityStatus, int ManagedItems, int MetadataPolicies, int PolicyDrafts, int ManagedRecords, HistoryEntry[] History, KeyValuePair<Guid, string>[] RecreatedRecords, int Pending, int RefreshPending, ApplicationReport[] Reports, string[] UnmatchedRules);
public sealed record IssueCatalogResponse(long Revision, IssueEntry[] Items, ApplicationReport[] ArchivedReports);
public sealed record IssueGuidance(string Group, string Summary, string Action, string? Path, JsonElement? Evidence);
public sealed record AliasRecord(Guid Id, string Name, Dictionary<string, string> ProviderIds);
public sealed record AliasRecordsResponse(AliasRecord[] Artists, AliasRecord[] Persons);
public sealed record AliasCandidate(Guid Id, string Name, string? Match = null);
public sealed record LocalNameSuggestion(string Name, string Source, AliasCandidate[] Artists, AliasCandidate[] Persons);
public sealed record AliasSuggestion(string? Name, string? Locale, string? Type);
public sealed record AliasSuggestionsResponse(string Source, string ArtistId, string? Name, bool ReviewRequired, AliasSuggestion[] Suggestions);
public sealed record AliasStatusResponse(long Generation, string[] Errors, IdentityReport[] Bindings);
public sealed record UnresolvedItem(Guid Id, string Name, string? Path, string Kind);
public sealed record UnresolvedCredit(string Credit, string Role, string Library, string? IdentityId, string Reason, AliasCandidate[] ArtistCandidates, AliasCandidate[] PersonCandidates, UnresolvedItem[] Items);
public sealed record InspectionFailure(Guid Id, string? Path, string Error, string CauseCode);
public sealed record UnresolvedResponse(int CheckedItems, int UnresolvedCredits, UnresolvedCredit[] Rows, InspectionFailure[] Failures);
