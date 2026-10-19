namespace MusicMetadataManager;

public sealed class DraftTarget
{
    public string Kind { get; set; } = "";
    public string Id { get; set; } = "";
}
public sealed class DraftDiscard
{
    public long ExpectedRevision { get; set; }
    public DraftTarget[] Targets { get; set; } = [];
}
public sealed partial class Corrections
{
    public async Task<object> DiscardDrafts(DraftDiscard input, CancellationToken token)
    {
        if (input.Targets is null || input.Targets.Length == 0 || input.Targets.Any(t => t is null || string.IsNullOrWhiteSpace(t.Id) || t.Kind is not ("rule" or "identity" or "policy")))
            throw new ArgumentException("Choose valid typed draft targets.");
        if (input.Targets.Select(t => (t.Kind, t.Id)).Distinct().Count() != input.Targets.Length)
            throw new ArgumentException("Duplicate draft targets are not allowed.");
        await gate.WaitAsync(token);
        try
        {
            if (input.ExpectedRevision != Doc.Revision)
                throw new InvalidOperationException("Configuration changed. Reload the selection before discarding drafts.");
            var d = Codec.Clone(Doc);
            foreach (var target in input.Targets)
            {
                var removed = target.Kind switch
                {
                    "rule" => d.Drafts.RemoveAll(x => x.Id == target.Id),
                    "identity" => d.IdentityDrafts.RemoveAll(x => x.Id == target.Id),
                    "policy" => d.PolicyDrafts.RemoveAll(x => x.Id == target.Id),
                    _ => 0
                };
                if (removed != 1) throw new ArgumentException("Draft not found: " + target.Kind + ":" + target.Id);
            }
            d.Revision++;
            Persist(d);
            return new { discarded = input.Targets, revision = d.Revision };
        }
        finally { gate.Release(); }
    }
}
