using System.Text.Json;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
namespace MusicMetadataManager;
public sealed class Inventory(ILibraryManager library,IDbContextFactory<JellyfinDbContext> database,MediaBrowser.Controller.IServerApplicationPaths applicationPaths,ILogger<Inventory> logger, IConfigurationStore configuration, IPluginStorage storage, IClock clock) {
 readonly object membershipGate=new();
 Dictionary<Guid,MusicRecordEvidence>? knownRecords;
 string MembershipPath=>Path.Combine(storage.DirectoryPath,"music-records.json");
 Dictionary<Guid,MusicRecordEvidence> KnownRecords=>knownRecords??=File.Exists(MembershipPath)?JsonSerializer.Deserialize<Dictionary<Guid,MusicRecordEvidence>>(File.ReadAllText(MembershipPath),Codec.Json)??throw new InvalidDataException("Empty music inventory evidence"):[];
 void SaveMembership(){try{var temp=MembershipPath+".tmp";File.WriteAllText(temp,JsonSerializer.Serialize(KnownRecords,Codec.Json));File.Move(temp,MembershipPath,true);}catch{knownRecords=null;throw;}}
 void Remember(BaseItem item,string reason){var type=item.GetType().FullName!;var path=item.Path??"";if(KnownRecords.TryGetValue(item.Id,out var old)&&old.NativeType==type&&old.Path==path)return;KnownRecords[item.Id]=new(type,path,reason,clock.UtcNow);}
 public void RecoverMembership(Journal state){
  lock(membershipGate){
   var previous=Codec.Hash(KnownRecords);var deletedArtists=new HashSet<string>();
   // A recorded successful deletion plus its recovery snapshot establishes the old type.
   var recovery=Path.Combine(storage.DirectoryPath,"recovery");
   if(Directory.Exists(recovery))foreach(var folder in Directory.EnumerateDirectories(recovery)){
    var file=Path.Combine(folder,"record.json");if(!File.Exists(file))continue;
    try{
     using var record=JsonDocument.Parse(File.ReadAllText(file));var root=record.RootElement;
     if(root.ValueKind==JsonValueKind.Object&&root.TryGetProperty("id",out var id)&&id.ValueKind==JsonValueKind.String&&id.TryGetGuid(out var recordId)&&state.DeletedRecords.ContainsKey(recordId)&&state.History.Any(h=>h.ItemId==recordId&&h.Operation=="delete verified orphan")&&root.TryGetProperty("dependencies",out var deps)&&deps.ValueKind==JsonValueKind.Object&&deps.TryGetProperty("kind",out var kind)&&kind.ValueKind==JsonValueKind.String&&kind.GetString()=="MusicArtist"&&root.TryGetProperty("name",out var name)&&name.ValueKind==JsonValueKind.String&&!string.IsNullOrWhiteSpace(name.GetString()))deletedArtists.Add(IdentityEngine.Key(name.GetString()!));
    }catch(Exception e)when(e is IOException or UnauthorizedAccessException or JsonException){logger.LogWarning(e,"Cannot use cleanup recovery snapshot as inventory evidence: {RecoveryFile}",file);}
   }
   foreach(var report in state.Reports.Where(r=>r.ItemId!=null&&r.Message=="Cleanup "+r.ItemId+": Record is not in the music inventory")){
    if(library.GetItemById(report.ItemId!.Value) is not Person item)continue;
    if(deletedArtists.Contains(IdentityEngine.Key(item.Name)))Remember(item,"Reviewed cleanup failure corroborated by deleted MusicArtist recovery snapshot");
   }
   if(previous!=Codec.Hash(KnownRecords))SaveMembership();
  }
 }
 public (string Id,string[] Paths) Scope(BaseItem item){
  var folders=library.GetVirtualFolders().Where(x=>x.CollectionType?.ToString().Equals("music",StringComparison.OrdinalIgnoreCase)==true).SelectMany(x=>x.Locations.Select(p=>(Id:x.ItemId,Path:p))).Where(x=>item.Path==x.Path||item.Path?.StartsWith(x.Path.TrimEnd('/')+"/",StringComparison.Ordinal)==true).OrderByDescending(x=>x.Path.Length).ToArray();return folders.Length==0?("",[]):(folders[0].Id,[folders[0].Path]);
 }
 public BaseItem[] Records(){
  var media=library.GetItemList(new InternalItemsQuery{Recursive=true,IncludeItemTypes=[BaseItemKind.Audio,BaseItemKind.MusicAlbum]}).Where(x=>Scope(x).Id!="").ToArray();
  var artists=library.GetItemList(new InternalItemsQuery{IncludeItemTypes=[BaseItemKind.MusicArtist]}).ToArray();
  var names=media.SelectMany(x=>library.GetPeople(x).Select(p=>IdentityEngine.Key(p.Name))).Concat(artists.SelectMany(x=>new[]{IdentityEngine.Key(x.Name),IdentityEngine.Key(Path.GetFileName((x.Path??"").TrimEnd('/')))})).ToHashSet();
  var rules=configuration.Current;var bound=rules.Identities.Concat(rules.IdentityDrafts).SelectMany(x=>x.Records).Concat(rules.Policies.Concat(rules.PolicyDrafts).Select(x=>x.ItemId)).ToHashSet();
  var persons=library.GetItemList(new InternalItemsQuery{IncludeItemTypes=[BaseItemKind.Person]}).ToArray();
  lock(membershipGate){
   var previous=Codec.Hash(KnownRecords);
   foreach(var item in artists)Remember(item,"Native MusicArtist record");
   foreach(var item in persons){
    var reason=names.Contains(IdentityEngine.Key(item.Name))||names.Contains(IdentityEngine.Key(Path.GetFileName((item.Path??"").TrimEnd('/'))))?"Matching scoped music credit or MusicArtist":bound.Contains(item.Id)?"Music identity or metadata policy binding":item.ProviderIds.Keys.Any(k=>k is "MusicBrainzArtist" or "ITunesArtist")?"Music artist provider ID":null;
    if(reason!=null)Remember(item,reason);
   }
   if(previous!=Codec.Hash(KnownRecords))SaveMembership();
   return media.Concat(artists).Concat(persons.Where(x=>KnownRecords.TryGetValue(x.Id,out var evidence)&&evidence.NativeType==x.GetType().FullName&&evidence.Path==(x.Path??""))).DistinctBy(x=>x.Id).ToArray();
  }
 }
 public Dependencies Inspect(BaseItem item,string[] scope,Document? document=null){
  var doc=document??configuration.Current;List<MusicUse> music=[],other=[];
  if(item is Audio or MusicAlbum){var lib=Scope(item).Id;if(lib!="")music.Add(new(item.Id,item.Name,item.Path??"",lib,[]));else other.Add(new(item.Id,item.Name,item.Path??"","",[]));}
  else {
   var identityNames=doc.Identities.Concat(doc.IdentityDrafts).Where(x=>x.Records.Contains(item.Id)).SelectMany(x=>x.Names);
   var basename=Path.GetFileName((item.Path??"").TrimEnd('/'));
   var names=identityNames.Concat(new[]{item.Name,basename}).Where(x=>!string.IsNullOrWhiteSpace(x)).Select(IdentityEngine.Key).ToHashSet();
   // Read-only EF projections inspect all media types, including live TV, without constructing every native object.
   using var refs=database.CreateDbContext();
   var people=refs.PeopleBaseItemMap.AsNoTracking().Select(p=>new{p.ItemId,p.People.Name,p.People.PersonType}).ToArray().Where(p=>names.Contains(IdentityEngine.Key(p.Name))).GroupBy(p=>p.ItemId).ToDictionary(g=>g.Key,g=>g.Select(p=>p.PersonType??"Unknown").Distinct().ToList());
   var folders=library.GetVirtualFolders().Where(x=>x.CollectionType?.ToString().Equals("music",StringComparison.OrdinalIgnoreCase)==true).SelectMany(x=>x.Locations.Select(p=>(Id:x.ItemId,Path:p))).ToArray();
   foreach(var media in refs.BaseItems.AsNoTracking().Select(x=>new{x.Id,x.Name,x.Path,x.Type,x.Artists,x.AlbumArtists}).ToArray()){
    var roles=people.GetValueOrDefault(media.Id)??[];
    if((media.Artists??"").Split('|',StringSplitOptions.RemoveEmptyEntries).Any(x=>names.Contains(IdentityEngine.Key(x))))roles.Add("Artist");
    if((media.AlbumArtists??"").Split('|',StringSplitOptions.RemoveEmptyEntries).Any(x=>names.Contains(IdentityEngine.Key(x))))roles.Add("AlbumArtist");
    if(roles.Count==0)continue;
    var lib=folders.Where(x=>media.Path==x.Path||media.Path?.StartsWith(x.Path.TrimEnd('/')+"/",StringComparison.Ordinal)==true).OrderByDescending(x=>x.Path.Length).Select(x=>x.Id).FirstOrDefault()??"";
    var use=new MusicUse(media.Id,media.Name??"",media.Path??"",lib,roles.Distinct().ToArray());if(lib!=""&&(media.Type==typeof(Audio).FullName||media.Type==typeof(MusicAlbum).FullName))music.Add(use);else other.Add(use);
   }
  }
  using var db=database.CreateDbContext();var descendants=db.BaseItems.AsNoTracking().Count(x=>x.ParentId==item.Id||x.OwnerId==item.Id);
  var links=db.LinkedChildren.AsNoTracking().Count(x=>x.ChildId==item.Id||x.ParentId==item.Id);
  var keys=item.GetUserDataKeys().ToArray();var userdata=db.UserData.AsNoTracking().Count(x=>x.ItemId==item.Id||keys.Contains(x.CustomDataKey));
  var bindings=doc.Identities.Concat(doc.IdentityDrafts).Where(x=>x.Records.Contains(item.Id)).Select(x=>x.Id).Distinct().ToArray();
  var policies=doc.Policies.Concat(doc.PolicyDrafts).Where(x=>x.ItemId==item.Id||x.IdentityId!=null&&doc.Identities.Concat(doc.IdentityDrafts).Any(i=>i.Id==x.IdentityId&&i.Records.Contains(item.Id))).Select(x=>x.Id).Concat(doc.Active.Concat(doc.Drafts).Where(x=>x.Metadata?.ItemId==item.Id||x.Kind!="alias"&&x.Path==item.Path).Select(x=>x.Id)).Distinct().ToArray();
  var missing=music.Select(x=>x.Library).Distinct().Except(scope).ToArray();
  bool native=item is MusicArtist or Person;
  var classification=other.Count>0?"shared with non-music media":music.Count>0?(native&&IdentityEngine.Key(Path.GetFileName((item.Path??"").TrimEnd('/')))!=IdentityEngine.Key(item.Name)?"broken name association / repair candidate":"referenced"):"orphan candidate";
  var safeMetadata=string.IsNullOrEmpty(item.Path)||SafeMetadataPath(item.Path);
  if(native&&!safeMetadata&&music.Count==0&&other.Count==0)classification="orphan candidate / unsafe metadata path";
  var canDelete=safeMetadata&&native&&music.Count==0&&other.Count==0&&descendants==0&&links==0&&userdata==0&&bindings.Length==0&&policies.Length==0;
  List<string> paths=[];if(native&&Directory.Exists(item.Path))paths.Add(item.Path);var internalPath=item.GetInternalMetadataPath();if(Directory.Exists(internalPath))paths.Add(internalPath);
  if(paths.Any(p=>!SafeMetadataPath(p)))canDelete=false;
  return new(item.Id,item.Name,item.Path??"",item is MusicArtist?"MusicArtist":item is Person?"Person":item is Audio?"track":"album",music.ToArray(),other.ToArray(),descendants,links,userdata,bindings,policies,missing,classification,other.Count==0&&missing.Length==0&&(music.Count>0||native),canDelete,paths.Distinct().ToArray());
 }
 bool SafeMetadataPath(string value){
  try{var full=Path.GetFullPath(value);var roots=new[]{applicationPaths.InternalMetadataPath,applicationPaths.DefaultInternalMetadataPath}.Distinct().Select(Path.GetFullPath).ToArray();var root=roots.FirstOrDefault(r=>full.StartsWith(r.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.Ordinal));if(root==null)return false;
   if(File.Exists(full)&&(File.GetAttributes(full)&FileAttributes.ReparsePoint)!=0)return false;
   for(var current=new DirectoryInfo(full);current!=null;current=current.Parent){if(current.Exists&&(current.Attributes&FileAttributes.ReparsePoint)!=0)return false;if(current.FullName==root)break;}
   return !library.GetVirtualFolders().SelectMany(f=>f.Locations).Any(p=>full==Path.GetFullPath(p)||full.StartsWith(Path.GetFullPath(p).TrimEnd('/')+"/",StringComparison.Ordinal));
  }catch{return false;}
 }
 public void EnsureWritable(BaseItem item,string[] libraries,Document? doc=null){var d=Inspect(item,libraries,doc);if(!d.CanEdit)throw new ArgumentException("This native record is global. Cover all music uses; non-music references make it read-only. Missing libraries: "+string.Join(",",d.MissingScope));}
 public BaseItem Item(Guid id)=>Records().FirstOrDefault(x=>x.Id==id)??throw new ArgumentException("Record is not in the music inventory");
 public Guid[] Targets(MetadataPolicy policy,Document? document=null){
  if(policy.IdentityId is null)return [policy.ItemId];var identity=(document??configuration.Current).Identities.SingleOrDefault(x=>x.Id==policy.IdentityId)??throw new ArgumentException("Active canonical identity not found");return new[]{identity.ArtistId,identity.PersonId}.Distinct().ToArray();
 }
}
