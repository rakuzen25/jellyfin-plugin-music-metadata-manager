namespace MusicMetadataManager;
public sealed class DocumentValidator(ILibraryCatalog catalog)
{
    public void Validate(Document d)
    {
        DocumentValidation.EnsureShape(d);
        if (d is null)
            throw new ArgumentException("Supply a rules document.");
        if (d.Active is null || d.Drafts is null || d.Identities is null || d.IdentityDrafts is null || d.Policies is null || d.PolicyDrafts is null)
            throw new ArgumentException("Active and draft rule lists must not be null.");
        if (d.SchemaVersion != DataFormat.Version)
            throw new ArgumentException("Unsupported rules schema version.");
        if (d.Active.Concat(d.Drafts).Any(r => r is null || r.Fields is null || r.TrackDefaults is null || r.Libraries is null || r.Names is null))
            throw new ArgumentException("Rules and field lists must not be null.");
        if (d.Policies.Concat(d.PolicyDrafts).Any(p => p is null || p.Fields is null || p.Libraries is null || p.Bindings is null || p.Snapshots is null || p.Images is null))
            throw new ArgumentException("Metadata policies and their lists must not be null.");
        var errors = Engine.Validate(d.Active);
        errors.AddRange(MetadataEngine.ValidatePolicies(d.Policies));
        foreach (var policy in d.PolicyDrafts)
            errors.AddRange(MetadataEngine.ValidatePolicies([policy]));
        if (d.PolicyDrafts.Select(x => x.Id).Distinct().Count() != d.PolicyDrafts.Count)
            errors.Add("Duplicate metadata draft IDs");
        if (d.Policies.Any(p => p.IdentityId != null && !d.Identities.Any(i => i.Id == p.IdentityId)))
            errors.Add("Stop managing canonical metadata before disabling or deleting its identity.");
        errors.AddRange(IdentityEngine.Validate(d.Identities));
        foreach (var identity in d.IdentityDrafts)
            errors.AddRange(IdentityEngine.Validate([identity]));
        if (d.IdentityDrafts.Select(x => x.Id).Distinct().Count() != d.IdentityDrafts.Count)
            errors.Add("Duplicate identity draft IDs.");
        foreach (var r in d.Drafts)
            errors.AddRange(Engine.Validate([r]));
        if (d.Drafts.Select(x => x.Id).Distinct().Count() != d.Drafts.Count)
            errors.Add("Duplicate draft IDs.");
        var libs = catalog.LibraryIds().ToHashSet();
        if (d.Active.Concat(d.Drafts).Any(r => r?.Libraries is null || r.Libraries.Any(id => !libs.Contains(id))))
            errors.Add("Select existing music library IDs.");
        if (d.Policies.Concat(d.PolicyDrafts).Any(p => p.Libraries.Any(id => !libs.Contains(id))))
            errors.Add("Select existing music library IDs for metadata policies.");
        if (Engine.Conflicts(d.Active)is { Length: > 0 } conflicts)
            throw new RuleConflictException(conflicts[0]);
        if (errors.Count > 0)
            throw new ArgumentException(string.Join("\n", errors.Distinct()));
    }
}
