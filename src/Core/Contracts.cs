using System.Text.Json;
using System.Text.Json.Serialization;
namespace MusicMetadataManager;


public sealed class Record
{
    public Guid Id
    {
        get; set;
    }
    public string Path { get; set; } = ""; public Dictionary<string, JsonElement> Original { get; set; } = []; public Dictionary<string, JsonElement> Applied { get; set; } = []; public string[] RuleIds { get; set; } = [];
}
public sealed class Journal
{
    public Dictionary<string,string> IdentityNames {get;set;}=[];
    public Dictionary<Guid,ManagedRecord> Metadata {get;set;}=[];public List<HistoryEntry> History {get;set;}=[];public Dictionary<Guid,RestoreValues> Restores {get;set;}=[];public Dictionary<Guid,string> DeletedRecords {get;set;}=[];
    [JsonRequired] public List<ApplicationReport> Reports {get;set;}=[]; [JsonRequired] public int SchemaVersion { get; set; } = DataFormat.Version; public Dictionary<Guid, Record> Items { get; set; } = []; public List<Guid> RefreshPending { get; set; } = [];
}
public sealed class Change
{
    public MetadataPolicy[] MetadataEdits {get;set;}=[];public string[] ActivatePolicies {get;set;}=[];public string[] DisablePolicies {get;set;}=[];public string[] DeletePolicies {get;set;}=[];public Relinquish[] Relinquish {get;set;}=[];public Guid[] CleanupIds {get;set;}=[];
    public ArtistIdentity[] IdentityEdits { get; set; } = []; public string[] ActivateIdentities { get; set; } = []; public string[] DisableIdentities { get; set; } = []; public string[] DeleteIdentities { get; set; } = [];
    public Rule[] Edits { get; set; } = []; public string[] ActivateIds { get; set; } = []; public string[] DisableIds { get; set; } = []; public string[] DeleteIds { get; set; } = [];
}
public sealed class Activation
{
    public string Token { get; set; } = "";
}
public sealed class Row
{
    public Guid Id
    {
        get; set;
    }
    public string Path { get; set; } = ""; public string Kind { get; set; } = ""; public bool Locked
    {
        get; set;
    }
    public string[] RuleIds { get; set; } = []; public Dictionary<string, JsonElement> Before { get; set; } = []; public Dictionary<string, JsonElement> After { get; set; } = []; public string[] ChangedFields { get; set; } = []; public string[] ReleasedFields { get; set; } = [];
}
public sealed class Preview
{
    public string Token { get; set; } = ""; public long Revision
    {
        get; set;
    }
    public object[] Restoration {get;set;}=[];
    public object[] Metadata {get;set;}=[];public object[] Cleanup {get;set;}=[];
    public object[] Identities { get; set; } = []; public List<Row> Items { get; set; } = []; public string[] UnmatchedRules { get; set; } = []; public string[] Warnings { get; set; } = [];
}

public sealed class ManagedRecord {
 public Guid Id {get;set;}public Dictionary<string,JsonElement> Original {get;set;}=[];public Dictionary<string,JsonElement> Applied {get;set;}=[];
 public Dictionary<string,ImageDecision> OriginalImages {get;set;}=[];public Dictionary<string,ImageDecision> AppliedImages {get;set;}=[];
}
public sealed record HistoryEntry(DateTime Time,long Revision,Guid ItemId,string Operation,string[] Fields);
public sealed class RestoreValues {public Dictionary<string,JsonElement> Fields {get;set;}=[];public Dictionary<string,ImageDecision> Images {get;set;}=[];}
public sealed class Relinquish {public Guid ItemId {get;set;}public string[] Fields {get;set;}=[];public string[] Images {get;set;}=[];public bool RestoreOriginal {get;set;}}

public sealed class ApplicationReport
{
 public string Id {get;set;}=Guid.NewGuid().ToString("N"); public string Message {get;set;}="";
 public DateTime CreatedAt {get;set;}=DateTime.UtcNow; public Guid? ItemId {get;set;} public DateTime? ArchivedAt {get;set;}
}
public sealed class ReportAcknowledgment {public string[] Ids {get;set;}=[];}
public sealed record IssueEntry(string Key,string Type,string Status,string Name,string Reason,bool CanRepair,bool CanDelete,bool CanAcknowledge,Guid? ItemId,string? IdentityId,object? Context,string CauseCode="",object? Guidance=null);
public sealed record CleanupOutcome(Guid Id,string Outcome,string? Reason,string? RecoveryPath);


// Administrator presentation projections. These never change the native library.
public sealed record NavigationPath(string Key,string Path,string Kind);
public sealed record InventoryRecord(Guid Id,string Name,string Kind,string? Path,bool Representative);
public sealed record InventoryEntry(Guid Id,string Name,string Kind,string? Path,string Library,bool Managed,string? IdentityId,string[] Aliases,InventoryRecord[] Records,bool MissingBinding);


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

public sealed record MusicUse(Guid Id,string Name,string Path,string Library,string[] Roles);
public sealed record Dependencies(Guid Id,string Name,string Path,string Kind,MusicUse[] Music,MusicUse[] NonMusic,int Descendants,int LinkedReferences,int UserData,string[] Bindings,string[] Policies,string[] MissingScope,string Classification,bool CanEdit,bool CanDelete,string[] MetadataPaths);
public sealed record MusicRecordEvidence(string NativeType,string Path,string Reason,DateTime ObservedAt);
public sealed class CompareRequest {
 public Guid ItemId {get;set;} public string Provider {get;set;}="";public string Key {get;set;}="";public string RecordId {get;set;}="";public bool Confirm {get;set;}
}
public sealed class ImageCacheRequest {
 public Guid ItemId {get;set;} public string SnapshotId {get;set;}="";public string Url {get;set;}="";public string Type {get;set;}="Primary";
}
