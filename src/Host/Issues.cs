using System.Text.Json;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using System.Security.Cryptography;
using System.Text;
namespace MusicMetadataManager;

public sealed partial class Corrections
{
    void AddReport(string message, Guid? itemId = null) => State.Reports.Add(new() { Message = message, ItemId = itemId, CreatedAt = clock.UtcNow });
    void InitializeReports()
    {
        if (State.Errors.Count + State.AcknowledgedErrors.Count == 0 && State.SchemaVersion == 3)
            return;
        foreach (var m in State.Errors)
            State.Reports.Add(new()
            {
                Message = m,
                CreatedAt = null
            });
        foreach (var m in State.AcknowledgedErrors)
            State.Reports.Add(new()
            {
                Message = m,
                CreatedAt = null,
                ArchivedAt = clock.UtcNow
            });
        State.Errors.Clear();
        State.AcknowledgedErrors.Clear();
        State.SchemaVersion = 3;
        SaveState();
    }
    public async Task<object> AcknowledgeReports(ReportAcknowledgment input, CancellationToken token)
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
            catch { foreach (var report in selected) report.ArchivedAt = null; throw; }
            return new
            {
                acknowledged = input.Ids
            };
        }
        finally { gate.Release(); }
    }
    public async Task<object> IssueCatalog(AliasService aliases, IDtoService dto, Guid userId, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var items = new List<IssueEntry>();
            var records = inventory.Records();
            var ids = records.Select(x => x.Id).ToHashSet();
            foreach (var item in records.Where(x => x is MusicArtist or Person))
            {
                var deps = inventory.Inspect(item, [], Doc);
                if (deps.Classification == "referenced")
                    continue;
                var repair = deps.Classification.Contains("repair candidate");
                var blockers = new[] { deps.Music.Length > 0 ? "music references" : null, deps.NonMusic.Length > 0 ? "non-music references" : null, deps.Descendants > 0 ? "descendants" : null, deps.LinkedReferences > 0 ? "linked references" : null, deps.UserData > 0 ? "user data" : null, deps.Bindings.Length > 0 ? "identity bindings" : null, deps.Policies.Length > 0 ? "managed policies" : null }.Where(x => x != null).ToArray();
                var reason = deps.Classification + (!deps.CanDelete && !repair ? "; deletion blocked by " + (blockers.Length > 0 ? string.Join(", ", blockers) : "unsafe internal metadata paths") : "");
                items.Add(new("record:" + item.Id.ToString("N"), repair ? "repair" : deps.CanDelete ? "orphan" : "blocked", deps.CanDelete ? "eligible" : repair && deps.NonMusic.Length == 0 ? "needs-review" : "blocked", item.Name, reason, repair && deps.NonMusic.Length == 0, deps.CanDelete, false, item.Id, null, deps));
            }
            foreach (var identity in Doc.Identities.Concat(Doc.IdentityDrafts).DistinctBy(x => x.Id).Where(i => !records.Any(x => x.Id == i.ArtistId && x is MusicArtist) || !records.Any(x => x.Id == i.PersonId && x is Person)))
                items.Add(new("binding:" + identity.Id, "binding", "needs-review", identity.PreferredName, "Missing representative; select an existing endpoint-compatible record.", true, false, false, null, identity.Id, identity));
            var unresolved = aliases.Unresolved(aliases.User(userId) ?? throw new InvalidOperationException("Authenticated user required"), dto);
            var data = JsonSerializer.SerializeToElement(unresolved, Codec.Json);
            foreach (var row in data.GetProperty("rows").EnumerateArray())
            {
                var credit = row.GetProperty("credit").GetString()!;
                var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(row.GetProperty("library").GetString() + "|" + row.GetProperty("role").GetString() + "|" + credit.Normalize(NormalizationForm.FormC))));
                var identityId = row.TryGetProperty("identityId", out var v) ? v.GetString() : null;
                items.Add(new("credit:" + key, "credit", "needs-review", credit, row.GetProperty("reason").GetString()!, true, false, false, null, identityId, row.Clone()));
            }
            foreach (var report in State.Reports.Where(r => r.ArchivedAt == null))
                items.Add(new("report:" + report.Id, "report", "report", report.Message, "Application failure; acknowledgment archives this occurrence without retrying.", false, false, true, report.ItemId is Guid target && ids.Contains(target) ? report.ItemId : null, null, report));
            foreach (var unmatched in MakePreview(Doc).UnmatchedRules)
            {
                var rule = Doc.Active.Single(x => x.Id == unmatched);
                items.Add(new("unmatched:" + unmatched, "unmatched", "live", string.IsNullOrWhiteSpace(rule.Label) ? rule.Path + rule.Credit : rule.Label, "Unmatched active correction; this live condition cannot be acknowledged.", true, false, false, null, null, rule));
            }
            foreach (var pair in State.DeletedRecords.Where(p => library.GetItemById(p.Key) != null))
                items.Add(new("recreated:" + pair.Key.ToString("N"), "recreated", "live", pair.Value, "Record recreated after cleanup; inspect it before another deletion.", false, false, false, pair.Key, null, null));
            foreach (var failure in data.GetProperty("failures").EnumerateArray())
                items.Add(new("audit:" + failure.GetProperty("path").GetString(), "audit", "blocked", failure.GetProperty("path").GetString()!, failure.GetProperty("error").GetString()!, false, false, false, failure.GetProperty("id").GetGuid(), null, failure.Clone()));
            return new
            {
                revision = Doc.Revision,
                items = items.Select(i => GuideIssue(i, records)).OrderBy(i => i.Type).ThenBy(i => i.Name).ToArray(),
                archivedReports = State.Reports.Where(r => r.ArchivedAt != null).ToArray()
            };
        }
        finally { gate.Release(); }
    }
    IssueEntry GuideIssue(IssueEntry issue, BaseItem[] records)
    {
        var context = JsonSerializer.SerializeToElement(issue.Context, Codec.Json);
        var item = issue.ItemId is Guid id ? records.FirstOrDefault(x => x.Id == id) : null;
        var path = item?.Path ?? (context.ValueKind == JsonValueKind.Object && context.TryGetProperty("path", out var p) ? p.GetString() : null);
        var group = issue.Type is "orphan" ? "cleanup" : issue.Type is "blocked" or "report" or "audit" ? "diagnostics" : "attention";
        string cause = issue.Type, summary = issue.Reason, action = "Inspect issue", name = issue.Name;
        object? evidence = issue.Context;
        switch (issue.Type)
        {
            case "credit":
                var credit = context.GetProperty("credit").GetString()!;
                var scope = context.GetProperty("library").GetString()!;
                var candidates = records.Where(x => x is MusicArtist or Person).Select(x => new
                {
                    id = x.Id,
                    name = x.Name,
                    kind = x is MusicArtist ? "MusicArtist" : "Person",
                    match = Doc.Identities.Concat(Doc.IdentityDrafts).Any(i => i.Libraries.Contains(scope) && i.Records.Contains(x.Id) && IdentityEngine.Matches(i, credit)) ? "identity" : IdentityEngine.Key(x.Name) == IdentityEngine.Key(credit) ? "name" : IdentityEngine.Key(Path.GetFileName((x.Path ?? "").TrimEnd('/'))) == IdentityEngine.Key(credit) ? "metadata-folder" : null
                }).Where(x => x.match != null).OrderBy(x => x.match == "identity" ? 0 : x.match == "name" ? 1 : 2).ThenBy(x => x.name).ToArray();
                cause = issue.IdentityId != null ? "identity-link-unresolved" : candidates.Any(x => x.kind == "MusicArtist") ? "record-link-unresolved" : "artist-record-missing";
                summary = "This credit has no working artist link.";
                action = "Repair artist link";
                evidence = new
                {
                    credit,
                    role = context.GetProperty("role").GetString(),
                    library = scope,
                    items = context.GetProperty("items"),
                    candidates,
                    identities = Doc.IdentityDrafts.Concat(Doc.Identities).DistinctBy(x => x.Id).Where(i => i.Libraries.Contains(scope)).Select(i => new { id = i.Id, name = i.PreferredName, match = IdentityEngine.Matches(i, credit) ? "identity" : null })
                };
                break;
            case "binding":
                cause = "representative-missing";
                summary = "A selected artist representative is missing.";
                action = "Rebind identity";
                evidence = new
                {
                    identity = issue.Context,
                    missing = new[] { !records.Any(x => x.Id == context.GetProperty("artistId").GetGuid() && x is MusicArtist) ? "MusicArtist" : null, !records.Any(x => x.Id == context.GetProperty("personId").GetGuid() && x is Person) ? "Person" : null }.Where(x => x != null)
                };
                break;
            case "repair":
                cause = "name-folder-mismatch";
                summary = "Stored and credited artist names may differ.";
                action = "Review artist name";
                break;
            case "orphan":
                cause = "verified-orphan";
                summary = "No dependencies were found; cleanup is optional.";
                action = "Review deletion";
                break;
            case "blocked":
                cause = "cleanup-protected";
                summary = "Dependencies or internal paths prevent safe cleanup.";
                action = "Inspect dependencies";
                break;
            case "report":
                cause = issue.Name.Contains("item no longer exists; pending refresh cancelled.", StringComparison.Ordinal) ? "item-missing" : issue.Name.Contains("Missing libraries:", StringComparison.Ordinal) ? "scope-incomplete" : issue.Name.Contains("non-music", StringComparison.OrdinalIgnoreCase) ? "non-music-protected" : issue.Name.Contains("preview this record again", StringComparison.Ordinal) ? "cleanup-review-stale" : issue.Name.StartsWith("Cleanup ", StringComparison.Ordinal) ? "cleanup-failure" : "application-failure";
                summary = cause switch
                {
                    "item-missing" => "The target disappeared before processing.",
                    "scope-incomplete" => "The selected scope does not cover every music use.",
                    "non-music-protected" => "Non-music references prevent this operation.",
                    "cleanup-review-stale" => "Cleanup dependencies changed after review.",
                    "cleanup-failure" => "Cleanup could not finish; inspect its recovery and dependency evidence.",
                    _ => "An operation reported a failure; inspect before retrying."
                };
                action = "Investigate failure";
                name = item is null ? "Operation failure" : item.Name + " · operation failure";
                break;
            case "unmatched":
                cause = "correction-unmatched";
                summary = "This correction currently matches no music.";
                action = "Update target";
                path = context.GetProperty("path").GetString();
                break;
            case "recreated":
                cause = "record-recreated";
                summary = "Native discovery recreated a deleted record.";
                action = "Inspect recreation";
                evidence = item == null ? null : inventory.Inspect(item, [], Doc);
                break;
            case "audit":
                cause = context.TryGetProperty("causeCode", out var auditCause) ? auditCause.GetString()! : "inspection-failed";
                summary = cause == "inspection-access-denied" ? "Inspection could not access this item." : cause == "inspection-io-failure" ? "Inspection encountered a file or metadata I/O failure." : "Artist links could not be checked for this item.";
                action = "Check inspection";
                break;
        }
        return issue with
        {
            Name = name,
            CauseCode = cause,
            Guidance = new
            {
                group,
                summary,
                action,
                path,
                evidence
            }
        };
    }

}
