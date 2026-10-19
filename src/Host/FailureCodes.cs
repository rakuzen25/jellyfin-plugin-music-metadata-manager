namespace MusicMetadataManager;
public static class FailureCodes
{
    public static string For(Exception error) => error switch
    {
        RuleConflictException => "rule_conflict",
        OperationRejectedException rejected => rejected.Code,
        ArgumentException => "validation_failed",
        InvalidOperationException => "state_conflict",
        HttpRequestException => "source_unavailable",
        OperationCanceledException => "operation_cancelled",
        IOException => "storage_unavailable",
        UnauthorizedAccessException => "access_denied",
        _ => "application_failure"
    };
}
