using System.Text.Json;

namespace MusicMetadataManager;
public sealed class ReportService(StateCoordinator state, IClock clock)
{
    SemaphoreSlim gate => state.Gate;

    Journal State => state.Journal;

    Document Doc => state.Document;

    void SaveState() => state.Commit();
    public void AddReport(string message, Guid? itemId = null, string code = "application-failure") => State.Reports.Add(new() { Code = code, Message = message, ItemId = itemId, CreatedAt = clock.UtcNow });
    public async Task<AcknowledgmentResult> AcknowledgeReports(ReportAcknowledgment input, CancellationToken token)
    {
        if (input.Ids is null || input.Ids.Length == 0 || input.Ids.Any(string.IsNullOrWhiteSpace) || input.Ids.Distinct().Count() != input.Ids.Length)
            throw new ArgumentException("Select unique report IDs.");
        await gate.WaitAsync(token);
        try
        {
            var selected = input.Ids.Select(id => State.Reports.SingleOrDefault(r => r.Id == id) ?? throw new ArgumentException("Report not found: " + id)).ToArray();
            if (selected.Any(r => r.ArchivedAt != null))
                throw new InvalidOperationException("A selected report is already archived. Refresh issues.");
            var at = clock.UtcNow;
            foreach (var report in selected)
                report.ArchivedAt = at;
            try
            {
                SaveState();
            }
            catch
            {
                foreach (var report in selected)
                    report.ArchivedAt = null;
                throw;
            }

            return new AcknowledgmentResult(input.Ids);
        }
        finally
        {
            gate.Release();
        }
    }
}
