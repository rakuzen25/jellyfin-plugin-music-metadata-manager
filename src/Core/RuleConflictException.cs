namespace MusicMetadataManager;
public sealed class RuleConflictException(string[] ruleIds) : ArgumentException("The selected rules manage overlapping fields.")
{
    public string[] RuleIds { get; } = ruleIds;
}
