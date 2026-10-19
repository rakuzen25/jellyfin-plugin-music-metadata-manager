using System.Xml.Serialization;
using System.Text.Json.Serialization;
using System.Text.Json;
namespace MusicMetadataManager;
// Null is a legitimate approved optional value. Absence of a decision means unmanaged.
public sealed class FieldDecision {
 public string Mode {get;set;}="approved";
 public JsonElement Value {get;set;}=JsonSerializer.SerializeToElement<object?>(null);
 public string Provenance {get;set;}="known";
 public string? SnapshotId {get;set;}
 public string? SourceField {get;set;}
}
public sealed class SourceBinding {
 public string Provider {get;set;}="";public string Key {get;set;}="";public string RecordId {get;set;}="";
 public DateTime ConfirmedAt {get;set;}
}
public sealed class SourceSnapshot {
 public string Id {get;set;}=Guid.NewGuid().ToString("N");public SourceBinding Binding {get;set;}=new();public DateTime RetrievedAt {get;set;}
 [XmlIgnore] public Dictionary<string,JsonElement> Offered {get;set;}=[]; [JsonIgnore] public string OfferedJson {get=>JsonSerializer.Serialize(Offered,Codec.Json);set=>Offered=JsonSerializer.Deserialize<Dictionary<string,JsonElement>>(value,Codec.Json)??[];} [XmlIgnore] public Dictionary<string,JsonElement> Configured {get;set;}=[]; [JsonIgnore] public string ConfiguredJson {get=>JsonSerializer.Serialize(Configured,Codec.Json);set=>Configured=JsonSerializer.Deserialize<Dictionary<string,JsonElement>>(value,Codec.Json)??[];}
 public string Provenance {get;set;}="known";
}
public sealed class ImageDecision {
 public string Mode {get;set;}="approved";public string? Hash {get;set;} public string? Mime {get;set;} public string? SnapshotId {get;set;} public string? SourceUrl {get;set;}
}
public sealed class MetadataPolicy {
 public string Id {get;set;}=Guid.NewGuid().ToString("N"); public string Label {get;set;}=""; public Guid ItemId {get;set;} public string? IdentityId {get;set;}
 public string[] Libraries {get;set;}=[];[XmlIgnore] public Dictionary<string,FieldDecision> Fields {get;set;}=[]; [JsonIgnore] public string FieldsJson {get=>JsonSerializer.Serialize(Fields,Codec.Json);set=>Fields=JsonSerializer.Deserialize<Dictionary<string,FieldDecision>>(value,Codec.Json)??[];} [XmlIgnore] public Dictionary<string,ImageDecision> Images {get;set;}=[]; [JsonIgnore] public string ImagesJson {get=>JsonSerializer.Serialize(Images,Codec.Json);set=>Images=JsonSerializer.Deserialize<Dictionary<string,ImageDecision>>(value,Codec.Json)??[];}
 public List<SourceBinding> Bindings {get;set;}=[];public List<SourceSnapshot> Snapshots {get;set;}=[];
}
public static class MetadataEngine {
 public static readonly string[] ExtendedFields=["sortName","overview","genres","tags","premiereDate","endDate","productionYear","country","providerIds","lockedFields","isLocked"];
 public static readonly string[] CoreFields=["title","album","artists","albumArtists","discNumber","trackNumber"];
 public static readonly string[] ImageTypes=["Primary","Backdrop","Banner","Logo","Thumb","Art","Disc","Box","BoxRear","Menu"];
 public static JsonElement Empty(string field)=>JsonSerializer.SerializeToElement<object?>(field switch {
  "genres" or "tags" or "country" or "lockedFields" =>Array.Empty<string>(),"providerIds"=>new Dictionary<string,string>(),_=>null});
 public static Dictionary<string,JsonElement> Values(Dictionary<string,FieldDecision> fields)=>fields.Where(x=>x.Value.Mode!="unmanaged").ToDictionary(x=>x.Key,x=>x.Value.Mode=="empty"?Empty(x.Key):x.Value.Value.Clone());
 public static List<string> ValidateFields(Dictionary<string,FieldDecision>? fields,bool artist=false) {
  List<string> errors=[];if(fields is null)return ["Field decisions must not be null."];
  foreach(var (field,d) in fields){
   if(!ExtendedFields.Concat(CoreFields).Contains(field)||artist&&field is "album" or "artists" or "albumArtists" or "discNumber" or "trackNumber")errors.Add("Unsupported field: "+field);
   if(d is null){errors.Add(field+": missing decision");continue;}
   if(d.Mode is not ("unmanaged" or "approved" or "empty"))errors.Add(field+": invalid management mode");
   if(d.Provenance is not ("known" or "inferred" or "unknown"))errors.Add(field+": invalid provenance");
   if(d.Mode=="unmanaged")continue;
   if(d.Mode=="empty"&&(CoreFields.Contains(field)||field=="isLocked"))errors.Add(field+": this required field cannot be empty");
   if(d.Mode=="empty")continue;
   var v=d.Value;
   bool valid=field switch {
    "title" or "album"=>v.ValueKind==JsonValueKind.String&&!string.IsNullOrWhiteSpace(v.GetString()),
    "sortName" or "overview"=>v.ValueKind==JsonValueKind.String,
    "artists" or "albumArtists"=>Names(v)&&v.GetArrayLength()>0,
    "genres" or "tags" or "country"=>Names(v),
    "lockedFields"=>Names(v),
    "discNumber" or "trackNumber"=>v.ValueKind==JsonValueKind.Number&&v.TryGetInt32(out var n)&&n>0,
    "productionYear"=>v.ValueKind==JsonValueKind.Number&&v.TryGetInt32(out var y)&&y is >=1 and <=9999,
    "premiereDate" or "endDate"=>v.ValueKind==JsonValueKind.String&&DateOnly.TryParseExact(v.GetString(),"yyyy-MM-dd",out _),
    "providerIds"=>v.ValueKind==JsonValueKind.Object&&v.EnumerateObject().All(x=>!string.IsNullOrWhiteSpace(x.Name)&&x.Value.ValueKind==JsonValueKind.String&&!string.IsNullOrWhiteSpace(x.Value.GetString())),
    "isLocked"=>v.ValueKind is JsonValueKind.True or JsonValueKind.False,_=>false};
   if(!valid)errors.Add(field+": invalid approved value (native dates require yyyy-MM-dd)");
  }
  return errors;
 }
 static bool Names(JsonElement v)=>v.ValueKind==JsonValueKind.Array&&v.EnumerateArray().All(x=>x.ValueKind==JsonValueKind.String&&!string.IsNullOrWhiteSpace(x.GetString()))&&v.EnumerateArray().Select(x=>x.GetString()).Distinct(StringComparer.OrdinalIgnoreCase).Count()==v.GetArrayLength();
 public static List<string> ValidatePolicies(IEnumerable<MetadataPolicy> input){
  List<string> errors=[];var policies=input.ToArray();
  if(policies.Any(p=>p is null))return ["Null metadata policy"];
  foreach(var p in policies){
   if(p is null){errors.Add("Null metadata policy");continue;}
   if(!Guid.TryParse(p.Id,out _))errors.Add("Policy ID must be a GUID");
   if((p.ItemId==Guid.Empty)==string.IsNullOrEmpty(p.IdentityId))errors.Add(p.Id+": select one record or canonical identity");
   if(p.Libraries is null||p.Libraries.Length==0||p.Libraries.Distinct().Count()!=p.Libraries.Length)errors.Add(p.Id+": select music libraries");
   if(p.Fields is null||p.Libraries is null){errors.Add("Policy fields and libraries must not be null");continue;}
   errors.AddRange(ValidateFields(p.Fields,true));
   if(p.Images is null||p.Bindings is null||p.Snapshots is null){errors.Add("Images, bindings and snapshots must not be null");continue;}
   if(p.Bindings.Any(b=>b is null)||p.Snapshots.Any(s=>s is null)){errors.Add("Source bindings and snapshots must not contain null entries");continue;}
   foreach(var (type,img) in p.Images){
    if(!ImageTypes.Contains(type)||img is null||img.Mode is not ("approved" or "empty" or "unmanaged"))errors.Add(p.Id+": invalid image decision");
    else if(img.Mode=="approved"&&(img.Hash?.Length!=64||!img.Hash.All(Uri.IsHexDigit)||img.Mime is not ("image/jpeg" or "image/png" or "image/webp")))errors.Add(p.Id+": approved images require a cached SHA256 and supported MIME type");
   }
   foreach(var binding in p.Bindings)if(binding is null||string.IsNullOrWhiteSpace(binding.Provider)||string.IsNullOrWhiteSpace(binding.Key)||string.IsNullOrWhiteSpace(binding.RecordId)||binding.ConfirmedAt==default)errors.Add(p.Id+": invalid confirmed source binding");
   foreach(var f in p.Fields.Values.Where(x=>x?.SnapshotId is not null))if(!p.Snapshots.Any(s=>s.Id==f.SnapshotId))errors.Add(p.Id+": missing approved source snapshot");
  }
  if(policies.Select(p=>p.Id).Distinct().Count()!=policies.Length)errors.Add("Duplicate metadata policy IDs");
  for(int i=0;i<policies.Length;i++)for(int j=i+1;j<policies.Length;j++)if(policies[i] is { Fields: not null,Images: not null } a&&policies[j] is { Fields: not null,Images: not null } b&&(a.ItemId!=Guid.Empty&&a.ItemId==b.ItemId||a.IdentityId!=null&&a.IdentityId==b.IdentityId)&&(a.Fields.Keys.Intersect(b.Fields.Keys).Any()||a.Images.Keys.Intersect(b.Images.Keys).Any()))errors.Add("Conflicting metadata policies: "+a.Id+" and "+b.Id);
  return errors;
 }
}
