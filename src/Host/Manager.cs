using Microsoft.Extensions.Logging;
using System.Text.Json;
using System.Security.Cryptography;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
namespace MusicMetadataManager;
public sealed partial class Corrections {
 IEnumerable<MetadataPolicy> AllPolicies(Document d)=>d.Policies.Concat(d.Active.Where(x=>x.Metadata!=null).Select(ToPolicy));
 Guid[] ManagedTargets(Document d)=>AllPolicies(d).SelectMany(p=>p.IdentityId is null?new[]{p.ItemId}:d.Identities.Where(i=>i.Id==p.IdentityId).SelectMany(i=>new[]{i.ArtistId,i.PersonId})).Distinct().ToArray();
 MetadataPolicy ToPolicy(Rule rule){var p=Codec.Clone(rule.Metadata??new MetadataPolicy{Id=rule.Id,ItemId=Items().First(x=>x.Path==rule.Path).Id,Libraries=rule.Libraries,Label=rule.Label});p.Fields=new(rule.Fields.Decisions);foreach(var (f,v) in rule.Fields.Values())if(!p.Fields.ContainsKey(f))p.Fields[f]=new(){Value=v,Provenance="unknown"};return p;}
 void PutPolicy(Document d,MetadataPolicy policy,bool draft=false){
  if(policy.ItemId!=Guid.Empty&&library.GetItemById(policy.ItemId) is BaseItem item&&(item is Audio or MusicAlbum)){
   var kind=item is Audio?"track":"album";var target=(draft?d.Drafts:d.Active);var rule=target.FirstOrDefault(x=>x.Id==policy.Id)??d.Active.FirstOrDefault(x=>x.Kind==kind&&x.Path==item.Path&&x.Libraries.Intersect(policy.Libraries).Any());
   rule=rule!=null?Codec.Clone(rule):new(){Id=policy.Id,Kind=kind,Path=item.Path!,Libraries=policy.Libraries,Label=policy.Label};
   // Exact manager edits use the existing correction rule and preserve its defaults.
   foreach(var (field,decision) in policy.Fields){
    var prop=typeof(Fields).GetProperties().SingleOrDefault(x=>string.Equals(x.Name,field,StringComparison.OrdinalIgnoreCase));if(prop is not null&&prop.Name!="Decisions"){prop.SetValue(rule.Fields,null);}
    if(decision.Mode=="unmanaged"&&!draft)rule.Fields.Decisions.Remove(field);else rule.Fields.Decisions[field]=Codec.Clone(decision);
   }
   var metadata=Codec.Clone(policy);metadata.Id=rule.Id;metadata.Fields=[];rule.Metadata=metadata;rule.Libraries=policy.Libraries;rule.Label=policy.Label;
   target.RemoveAll(x=>x.Id==rule.Id);if(draft&&rule.Fields.Decisions.Values.Any(f=>f.Mode=="unmanaged")||rule.Fields.Values().Count>0||rule.TrackDefaults.Values().Count>0||policy.Images.Values.Any(x=>x.Mode!="unmanaged")||policy.Bindings.Count>0)target.Add(rule);
   if(!draft)d.Drafts.RemoveAll(x=>x.Id==rule.Id);
  }else {
   var target=draft?d.PolicyDrafts:d.Policies;target.RemoveAll(x=>x.Id==policy.Id);target.Add(Codec.Clone(policy));if(!draft)d.PolicyDrafts.RemoveAll(x=>x.Id==policy.Id);
  }
 }
 void CandidateMetadata(Document d,Change c){
  if(c.MetadataEdits is null||c.ActivatePolicies is null||c.DisablePolicies is null||c.DeletePolicies is null||c.Relinquish is null||c.CleanupIds is null)throw new ArgumentException("Manager change lists must not be null");
  var ids=c.MetadataEdits.Select(x=>x.Id).Concat(c.ActivatePolicies).Concat(c.DisablePolicies).Concat(c.DeletePolicies).ToArray();if(ids.Distinct().Count()!=ids.Length)throw new ArgumentException("A metadata policy cannot have multiple actions");
  foreach(var p in c.MetadataEdits.Concat(c.ActivatePolicies.Select(id=>d.PolicyDrafts.SingleOrDefault(x=>x.Id==id)??throw new ArgumentException("Metadata draft not found: "+id))))PutPolicy(d,p);
  foreach(var id in c.DisablePolicies){var p=d.Policies.SingleOrDefault(x=>x.Id==id)??throw new ArgumentException("Metadata policy not found");d.PolicyDrafts.RemoveAll(x=>x.Id==id);d.PolicyDrafts.Add(Codec.Clone(p));d.Policies.RemoveAll(x=>x.Id==id);}
  foreach(var id in c.DeletePolicies){if(d.Policies.RemoveAll(x=>x.Id==id)+d.PolicyDrafts.RemoveAll(x=>x.Id==id)==0)throw new ArgumentException("Metadata policy not found");}
  foreach(var r in c.Relinquish){
   var item=inventory.Item(r.ItemId);
   foreach(var p in d.Policies.Where(x=>inventory.Targets(x,d).Contains(item.Id))){foreach(var field in r.Fields)p.Fields.Remove(field);foreach(var type in r.Images)p.Images.Remove(type);}
   foreach(var rule in d.Active.Where(x=>x.Path==item.Path&&x.Kind!="alias")){
    foreach(var field in r.Fields){rule.Fields.Decisions.Remove(field);var property=typeof(Fields).GetProperties().FirstOrDefault(p=>string.Equals(p.Name,field,StringComparison.OrdinalIgnoreCase));if(property!=null&&property.Name!="Decisions")property.SetValue(rule.Fields,null);}
    if(rule.Metadata is { } meta)foreach(var type in r.Images)meta.Images.Remove(type);
   }
  }
  foreach(var oldPolicy in Doc.Policies){
   var policyTargets=oldPolicy.IdentityId is null?new[]{oldPolicy.ItemId}:new[]{Doc.Identities.Single(i=>i.Id==oldPolicy.IdentityId).ArtistId};
   foreach(var id in policyTargets){
    if(ExpandedRelinquish(c).Any(r=>r.ItemId==id))continue;
    var remaining=AllPolicies(d).Where(p=>inventory.Targets(p,d).Contains(id)).ToArray();
    var fields=MetadataEngine.Values(oldPolicy.Fields).Keys.Except(remaining.SelectMany(p=>MetadataEngine.Values(p.Fields).Keys)).ToArray();var images=oldPolicy.Images.Where(i=>i.Value.Mode!="unmanaged").Select(i=>i.Key).Except(remaining.SelectMany(p=>p.Images.Where(i=>i.Value.Mode!="unmanaged").Select(i=>i.Key))).ToArray();
    if(fields.Length>0||images.Length>0)c.Relinquish=c.Relinquish.Append(new Relinquish{ItemId=id,Fields=fields,Images=images}).ToArray();
   }
  }
  // Per-field Unmanaged in the manager has the same retained-value semantics as Stop managing.
  // Include fields derived on child tracks by an edited album rule, while retaining explicit rule removal semantics.
  var requestedPaths=c.MetadataEdits.Where(p=>p.ItemId!=Guid.Empty).Select(p=>library.GetItemById(p.ItemId)?.Path).Concat(c.Relinquish.Select(r=>library.GetItemById(r.ItemId)?.Path)).Where(p=>p!=null).ToHashSet();
  var editedRules=Doc.Active.Where(r=>r.Kind!="alias"&&(requestedPaths.Contains(r.Path)||c.ActivateIds.Contains(r.Id)&&d.Active.Any(n=>n.Id==r.Id&&n.Metadata!=null))).ToArray();
  var explicitTargets=ExpandedRelinquish(c).Select(r=>r.ItemId).ToHashSet();
  foreach(var item in Items().Where(i=>!explicitTargets.Contains(i.Id)&&editedRules.Any(r=>i.Path==r.Path||r.Kind=="album"&&i is Audio&&i.Path?.StartsWith(r.Path.TrimEnd('/')+"/",StringComparison.Ordinal)==true))){
   if(!State.Items.TryGetValue(item.Id,out var old))continue;
   var remaining=Project(item,Baseline(Describe(item)),d.Active).Values.Keys.ToHashSet();var relinquished=old.Applied.Keys.Except(remaining).ToArray();
   if(relinquished.Length>0)c.Relinquish=c.Relinquish.Append(new Relinquish{ItemId=item.Id,Fields=relinquished}).ToArray();
  }
  foreach(var operation in ExpandedRelinquish(c).Where(x=>x.RestoreOriginal&&x.Fields.Contains("title"))){
   var identity=d.Identities.FirstOrDefault(x=>x.ArtistId==operation.ItemId||x.PersonId==operation.ItemId);
   if(identity!=null&&State.IdentityNames.TryGetValue(identity.Id,out var originalName)){identity.Aliases=identity.Aliases.Append(identity.PreferredName).Distinct().ToArray();identity.PreferredName=originalName;}
  }
  d.Active.RemoveAll(x=>x.Kind!="alias"&&x.Fields.Values().Count==0&&x.TrackDefaults.Values().Count==0&&(x.Metadata is null||!x.Metadata.Images.Values.Any(i=>i.Mode!="unmanaged")&&x.Metadata.Bindings.Count==0));
  foreach(var edited in c.IdentityEdits){
   var old=Doc.Identities.FirstOrDefault(x=>x.Id==edited.Id);if(old is null||old.PreferredName==edited.PreferredName)continue;
   var identity=d.Identities.First(x=>x.Id==edited.Id);identity.Aliases=identity.Aliases.Append(old.PreferredName).Distinct().ToArray();
   foreach(var policy in d.Policies.Where(p=>p.IdentityId==edited.Id&&p.Fields.ContainsKey("title")))policy.Fields["title"]=new(){Value=JsonSerializer.SerializeToElement(edited.PreferredName),Provenance="known"};
  }
  foreach(var policy in d.Policies.Where(x=>x.IdentityId!=null&&x.Fields.TryGetValue("title",out var field)&&field.Mode=="approved")){
   var identity=d.Identities.SingleOrDefault(x=>x.Id==policy.IdentityId)??throw new ArgumentException("Canonical identity missing");var name=policy.Fields["title"].Value.GetString()!;
   if(identity.PreferredName!=name){identity.Aliases=identity.Aliases.Append(identity.PreferredName).Distinct(StringComparer.Ordinal).ToArray();identity.PreferredName=name;}
  }
 }
 void ValidateMetadata(Document d){
  foreach(var group in AllPolicies(d).SelectMany(p=>inventory.Targets(p,d).Select(id=>(Id:id,Policy:p))).GroupBy(x=>x.Id)){
   var fields=group.SelectMany(x=>x.Policy.Fields.Where(f=>f.Value.Mode!="unmanaged").Select(f=>f.Key)).ToArray();var images=group.SelectMany(x=>x.Policy.Images.Where(f=>f.Value.Mode!="unmanaged").Select(f=>f.Key)).ToArray();
   if(fields.Distinct().Count()!=fields.Length||images.Distinct().Count()!=images.Length)throw new ArgumentException("Conflicting standalone and canonical metadata for "+group.Key);
  }
  foreach(var policy in AllPolicies(d)){
   var unchanged=AllPolicies(Doc).Any(old=>Codec.Hash(old)==Codec.Hash(policy));if(unchanged)continue;
   var targets=inventory.Targets(policy,d);if(targets.Length==0)throw new ArgumentException("Metadata target missing");
   foreach(var id in targets){var item=inventory.Item(id);inventory.EnsureWritable(item,policy.Libraries,d);if(item is MusicArtist or Person){var errors=MetadataEngine.ValidateFields(policy.Fields,true);if(errors.Count>0)throw new ArgumentException(string.Join("\n",errors));}}
   sources.ValidatePolicy(policy,targets);
   foreach(var f in policy.Fields.Values.Where(x=>x.Mode=="approved"))if(f.Value.ValueKind==JsonValueKind.Undefined)throw new ArgumentException("Approved field requires a value");
   foreach(var locked in policy.Fields.Where(x=>x.Key=="lockedFields"&&x.Value.Mode=="approved").SelectMany(x=>x.Value.Value.Deserialize<string[]>()??[]))if(!Enum.TryParse<MetadataField>(locked,out _))throw new ArgumentException("Unknown native lock: "+locked);
  }
  foreach(var rule in d.Active.Where(x=>x.Fields.Decisions.Count>0)){foreach(var locked in rule.Fields.Decisions.Where(x=>x.Key=="lockedFields"&&x.Value.Mode=="approved").SelectMany(x=>x.Value.Value.Deserialize<string[]>()??[]))if(!Enum.TryParse<MetadataField>(locked,out _))throw new ArgumentException("Unknown native lock: "+locked);foreach(var item in Items().Where(x=>x.Path==rule.Path))inventory.EnsureWritable(item,rule.Libraries,d);}
 }
 object ImageState(BaseItem item,string type){var images=item.GetImages(Enum.Parse<ImageType>(type)).ToArray();return images.Select(x=>new{path=x.Path,hash=File.Exists(x.Path)?Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(x.Path))):null}).ToArray();}
 object[] MetadataPreview(Document d){
  List<object> rows=[];foreach(var policy in AllPolicies(d))foreach(var id in inventory.Targets(policy,d)){
   var item=library.GetItemById(id);if(item==null){rows.Add(new{id,policyId=policy.Id,error="Metadata target missing; rebind this policy",sources=policy.Snapshots});continue;}var actual=NativeMetadata.Read(item);var targets=MetadataEngine.Values(policy.Fields);
   rows.Add(new{id,policyId=policy.Id,identityId=policy.IdentityId,name=item.Name,kind=item.GetType().Name,before=actual,after=targets,images=policy.Images,storedImages=policy.Images.Keys.ToDictionary(x=>x,x=>ImageState(item,x)),locks=item.LockedFields.Select(x=>x.ToString()),item.IsLocked,dependencies=inventory.Inspect(item,policy.Libraries,d),sources=policy.Snapshots,scrobblingRelevant=item is Audio or MusicAlbum && d.Active.Any(r=>r.Path==item.Path&&r.Fields.Values().Keys.Any(MetadataEngine.CoreFields.Contains))});
  }
  return rows.ToArray();
 }
 public async Task QueueManaged(CancellationToken token){await gate.WaitAsync(token);try{foreach(var id in ManagedTargets(Doc).Concat(State.Restores.Keys).Distinct())refreshQueue.Enqueue(id,false);}finally{gate.Release();}}

 public async Task SaveMetadataDraft(MetadataPolicy p,CancellationToken token){await gate.WaitAsync(token);try{var d=Codec.Clone(Doc);PutPolicy(d,p,true);ValidateDocument(d);d.Revision++;Persist(d);}finally{gate.Release();}}
 public async Task DeleteMetadataDraft(string id,CancellationToken token){await gate.WaitAsync(token);try{var d=Codec.Clone(Doc);if(d.PolicyDrafts.RemoveAll(x=>x.Id==id)==0)throw new ArgumentException("Metadata draft not found");d.Revision++;Persist(d);}finally{gate.Release();}}
 public async Task<object> ManagerInventory(string? search,string? libraryId,string? kind,int start,int limit,CancellationToken token){
  await gate.WaitAsync(token);try{
   if(start<0||limit<1||limit>200)throw new ArgumentException("Use a nonnegative start and limit 1–200");
   var records=inventory.Records().Where(x=>kind is null||x.GetType().Name==kind||kind=="artist"&&x is MusicArtist or Person||kind=="track"&&x is Audio||kind=="album"&&x is MusicAlbum).Where(x=>search is null||x.Name.Contains(search,StringComparison.OrdinalIgnoreCase)||(x.Path??"").Contains(search,StringComparison.OrdinalIgnoreCase)).OrderBy(x=>x.Name,StringComparer.OrdinalIgnoreCase).ThenBy(x=>x.Id).ToArray();
   // Scope artist records by actual uses, retain true orphans when browsing all music.
   var list=records.Select(x=>new{item=x,scope=inventory.Scope(x)}).Where(x=>libraryId is null||x.scope.Id==libraryId||x.item is MusicArtist or Person&&inventory.Inspect(x.item,[libraryId]).Music.Any(u=>u.Library==libraryId)).ToArray();
   return new{total=list.Length,start,limit,items=list.Skip(start).Take(limit).Select(x=>new{id=x.item.Id,name=x.item.Name,path=x.item.Path,kind=x.item.GetType().Name,library=x.scope.Id,identities=Doc.Identities.Where(i=>i.Records.Contains(x.item.Id)).Select(i=>new{id=i.Id,name=i.PreferredName,representative=i.ArtistId==x.item.Id||i.PersonId==x.item.Id}).ToArray(),managed=State.Metadata.ContainsKey(x.item.Id)||State.Items.ContainsKey(x.item.Id)}).ToArray(),canonicalIdentities=Doc.Identities.Select(x=>new{id=x.Id,name=x.PreferredName,aliases=x.Aliases,records=x.Records,libraries=x.Libraries}).ToArray()};
  }finally{gate.Release();}
 }
 public async Task<object> ManagerDetails(Guid id,CancellationToken token){await gate.WaitAsync(token);try{
  var item=inventory.Item(id);var policies=AllPolicies(Doc).Where(x=>inventory.Targets(x,Doc).Contains(id)).ToArray();var identity=Doc.Identities.SingleOrDefault(x=>x.Records.Contains(id));var scope=inventory.Scope(item);var libs=scope.Id!=""?new[]{scope.Id}:inventory.Inspect(item,[]).Music.Select(x=>x.Library).Distinct().ToArray();
  var rule=Doc.Active.FirstOrDefault(x=>x.Path==item.Path&&x.Kind==(item is Audio?"track":"album"));
  var edit=policies.FirstOrDefault(x=>x.IdentityId==identity?.Id)??policies.FirstOrDefault()??(rule!=null?ToPolicy(rule):new MetadataPolicy{ItemId=identity is null?id:Guid.Empty,IdentityId=identity?.Id,Libraries=identity?.Libraries??libs,Label=identity?.PreferredName??item.Name});
  if(item is Audio or MusicAlbum&&rule!=null)edit=ToPolicy(rule);
  return new{id,name=item.Name,kind=item.GetType().Name,path=item.Path,stored=NativeMetadata.Read(item),effective=NativeMetadata.Read(item).Select(x=>new{field=x.Key,value=x.Key=="title"&&identity!=null?JsonSerializer.SerializeToElement(identity.PreferredName):x.Value}).ToDictionary(x=>x.field,x=>x.value),policy=edit,policies,drafts=Doc.PolicyDrafts.Where(x=>x.ItemId==id||x.IdentityId==identity?.Id).Concat(Doc.Drafts.Where(x=>x.Metadata?.ItemId==id).Select(ToPolicy)).ToArray(),dependencies=inventory.Inspect(item,libs),providerCandidates=item.ProviderIds.Select(x=>new{key=x.Key,recordId=x.Value,confirmed=policies.Any(p=>p.Bindings.Any(b=>b.Key==x.Key&&b.RecordId==x.Value))}).ToArray(),providers=sources.Providers(item),locks=item.LockedFields.Select(x=>x.ToString()).ToArray(),item.IsLocked,original=State.Metadata.GetValueOrDefault(id),correctionOriginal=State.Items.GetValueOrDefault(id),images=item.ImageInfos.Select(x=>new{type=x.Type.ToString(),path=x.Path}).ToArray(),history=State.History.Where(x=>x.ItemId==id).ToArray(),refreshBehavior="Only approved fields/images are reasserted after refresh; unmanaged fields follow Jellyfin. Stored IDs and NFO files do not establish historical field provenance."};
 }finally{gate.Release();}}
 Relinquish[] ExpandedRelinquish(Change change)=>change.Relinquish.SelectMany(r=>{
  var policy=Doc.Policies.FirstOrDefault(p=>p.IdentityId!=null&&inventory.Targets(p,Doc).Contains(r.ItemId));
  return (policy==null?new[]{r.ItemId}:inventory.Targets(policy,Doc)).Select(id=>new Relinquish{ItemId=id,Fields=r.Fields,Images=r.Images,RestoreOriginal=r.RestoreOriginal});
 }).GroupBy(x=>x.ItemId).Select(g=>g.Single()).ToArray();
 object[] RelinquishPreview(Change c,Document d)=>ExpandedRelinquish(c).Select(r=>{
  var item=inventory.Item(r.ItemId);var original=new Dictionary<string,JsonElement>();var images=new Dictionary<string,ImageDecision>();
  foreach(var f in r.Fields){if(State.Items.TryGetValue(item.Id,out var core)&&core.Original.TryGetValue(f,out var v))original[f]=v;else if(State.Metadata.TryGetValue(item.Id,out var meta)&&meta.Original.TryGetValue(f,out v))original[f]=v;else if(r.RestoreOriginal)throw new ArgumentException("No recorded original value for "+f);}
  foreach(var type in r.Images){if(State.Metadata.TryGetValue(item.Id,out var meta)&&meta.OriginalImages.TryGetValue(type,out var v))images[type]=v;else if(r.RestoreOriginal)throw new ArgumentException("No recorded original image for "+type);}
  return (object)new{id=item.Id,name=item.Name,operation=r.RestoreOriginal?"restore original":"stop managing",before=NativeMetadata.Read(item),after=r.RestoreOriginal?original:NativeMetadata.Read(item),originalImages=images,fields=r.Fields,imageTypes=r.Images};
 }).ToArray();
 Guid[] CommitMetadata(Document next,Change change){
  var originals=Codec.Clone(State.Metadata);
  foreach(var policy in next.Policies.Where(p=>p.IdentityId!=null&&p.Fields.ContainsKey("title")))if(!State.IdentityNames.ContainsKey(policy.IdentityId!))State.IdentityNames[policy.IdentityId!]=Doc.Identities.FirstOrDefault(x=>x.Id==policy.IdentityId)?.PreferredName??change.IdentityEdits.FirstOrDefault(x=>x.Id==policy.IdentityId)?.PreferredName??next.Identities.First(x=>x.Id==policy.IdentityId).PreferredName;
  var targets=ManagedTargets(next).Concat(ManagedTargets(Doc)).Concat(change.Relinquish.Select(x=>x.ItemId)).Distinct().ToArray();
  foreach(var id in targets){
   var item=library.GetItemById(id);if(item==null)continue;
   var active=AllPolicies(next).Where(x=>inventory.Targets(x,next).Contains(id)).ToArray();var desired=active.SelectMany(p=>MetadataEngine.Values(p.Fields).Keys).ToHashSet();var images=active.SelectMany(p=>p.Images.Where(x=>x.Value.Mode!="unmanaged").Select(x=>x.Key)).ToHashSet();
   if(State.Metadata.TryGetValue(id,out var record)){foreach(var f in record.Applied.Keys.Except(desired).ToArray()){record.Applied.Remove(f);}foreach(var type in record.AppliedImages.Keys.Except(images).ToArray()){record.AppliedImages.Remove(type);}}
  }
  foreach(var operation in ExpandedRelinquish(change)){
   var item=inventory.Item(operation.ItemId);var fields=new Dictionary<string,JsonElement>();var images=new Dictionary<string,ImageDecision>();
   if(State.Items.TryGetValue(item.Id,out var core)){foreach(var f in operation.Fields){if(core.Original.TryGetValue(f,out var value))fields[f]=value;var archived=State.Metadata.GetValueOrDefault(item.Id)??new ManagedRecord{Id=item.Id};if(core.Original.TryGetValue(f,out var original)&&!archived.Original.ContainsKey(f))archived.Original[f]=original;State.Metadata[item.Id]=archived;core.Applied.Remove(f);core.Original.Remove(f);}}
   // Originals must be captured before automatic relinquishment pruning above.
   if(originals.TryGetValue(item.Id,out var meta)){foreach(var f in operation.Fields){if(meta.Original.TryGetValue(f,out var value))fields[f]=value;if(State.Metadata.TryGetValue(item.Id,out var durable))durable.Applied.Remove(f);}foreach(var type in operation.Images){if(meta.OriginalImages.TryGetValue(type,out var original))images[type]=original;if(State.Metadata.TryGetValue(item.Id,out var durable))durable.AppliedImages.Remove(type);}}
   if(operation.RestoreOriginal){if(fields.Count!=operation.Fields.Length||images.Count!=operation.Images.Length)throw new ArgumentException("Original values are unavailable for one or more requested fields");State.Restores[item.Id]=new(){Fields=fields,Images=images};
}
   State.History.Add(new(clock.UtcNow,Doc.Revision+1,item.Id,operation.RestoreOriginal?"restore original":"stop managing",operation.Fields.Concat(operation.Images).ToArray()));
  }
  SaveState();return targets;
 }
 async Task<ItemUpdateType> CorrectMetadata(BaseItem item,bool persist,CancellationToken token){
  if(!persist)return ItemUpdateType.None;
  var policies=AllPolicies(Doc).Where(x=>inventory.Targets(x,Doc).Contains(item.Id)).ToArray();
  var targetFields=item is Audio or MusicAlbum?new Dictionary<string,JsonElement>():policies.SelectMany(x=>MetadataEngine.Values(x.Fields)).ToDictionary(x=>x.Key,x=>x.Value);
  var targetImages=policies.SelectMany(x=>x.Images.Where(i=>i.Value.Mode!="unmanaged")).ToDictionary(x=>x.Key,x=>x.Value);
  var restore=State.Restores.GetValueOrDefault(item.Id);if(restore!=null){foreach(var f in restore.Fields)targetFields[f.Key]=f.Value;foreach(var image in restore.Images)targetImages[image.Key]=image.Value;}
  if(item is Audio or MusicAlbum&&State.Items.TryGetValue(item.Id,out var core)&&Doc.Active.Any(r=>r.Metadata?.ItemId==item.Id)){
   var retained=State.Metadata.GetValueOrDefault(item.Id)??new ManagedRecord{Id=item.Id};foreach(var f in core.Original)if(!retained.Original.ContainsKey(f.Key))retained.Original[f.Key]=f.Value;State.Metadata[item.Id]=retained;SaveState();
  }
  if(targetFields.Count==0&&targetImages.Count==0)return ItemUpdateType.None;
  // Recheck global uses on each write, including provider refreshes, not only activation.
  foreach(var p in policies)inventory.EnsureWritable(item,p.Libraries);
  var current=NativeMetadata.Read(item);var record=State.Metadata.GetValueOrDefault(item.Id)??new ManagedRecord{Id=item.Id};
  var changed=targetFields.Where(x=>!Engine.Equal(current[x.Key],x.Value)).ToArray();
  foreach(var f in targetFields){if(!record.Original.ContainsKey(f.Key))record.Original[f.Key]=current[f.Key];if(restore?.Fields.ContainsKey(f.Key)!=true)record.Applied[f.Key]=f.Value;}
  foreach(var (type,decision) in targetImages){if(!record.OriginalImages.ContainsKey(type))record.OriginalImages[type]=sources.CacheCurrent(item,type);if(restore?.Images.ContainsKey(type)!=true)record.AppliedImages[type]=decision;}
  State.Metadata[item.Id]=record;SaveState();bool imageChanged=false;
  foreach(var decision in targetImages.Values.Where(x=>x.Mode=="approved"))if(!sources.HasImage(decision.Hash!))throw new IOException("Pinned image unavailable or hash mismatch: "+decision.Hash);
  foreach(var f in changed)NativeMetadata.Write(item,f.Key,f.Value);
  foreach(var (type,decision) in targetImages){
   var nativeType=Enum.Parse<ImageType>(type);var registered=item.GetImages(nativeType).ToArray();
   if(decision.Mode=="empty"){if(registered.Length>0){item.RemoveImages(registered);imageChanged=true;}continue;}
   if(!sources.HasImage(decision.Hash!))throw new IOException("Pinned image unavailable or hash mismatch: "+decision.Hash);
   if(registered.Length==1&&File.Exists(registered[0].Path)&&Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(registered[0].Path)))==decision.Hash)continue;
   item.RemoveImages(registered);await using var stream=File.OpenRead(sources.ImagePath(decision.Hash!));await providers.SaveImage(item,stream,decision.Mime!,nativeType,0,token);imageChanged=true;
  }
  if(changed.Length>0||imageChanged){await library.UpdateItemAsync(item,item.GetParent()!,ItemUpdateType.MetadataEdit|(imageChanged?ItemUpdateType.ImageUpdate:ItemUpdateType.None),token);State.History.Add(new(clock.UtcNow,Doc.Revision,item.Id,restore!=null?"restore":"apply",changed.Select(x=>x.Key).Concat(imageChanged?targetImages.Keys:[]).ToArray()));}
  State.Restores.Remove(item.Id);SaveState();return changed.Length>0||imageChanged?ItemUpdateType.MetadataEdit:ItemUpdateType.None;
 }
 object CleanupSnapshot(BaseItem item,Document d){
  var deps=inventory.Inspect(item,[],d);
  if(!deps.CanDelete)throw new InvalidOperationException(item.Name+" is not a verified orphan. Current dependencies or internal paths block deletion.");
  return new{id=item.Id,name=item.Name,dependencies=deps,removesInternalMetadataAndArtwork=true,sourceFilesDeleted=false,files=deps.MetadataPaths.SelectMany(p=>Directory.EnumerateFiles(p,"*",SearchOption.AllDirectories)).Distinct().OrderBy(p=>p,StringComparer.Ordinal).Select(p=>new{path=p,hash=Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p)))}).ToArray()};
 }
 string CleanupFingerprint(BaseItem item,object snapshot)=>Codec.Hash(new{nativeType=item.GetType().FullName,snapshot});
 object[] CleanupPreview(Guid[] ids,Document d){
  if(ids.Any(id=>id==Guid.Empty)||ids.Distinct().Count()!=ids.Length)throw new ArgumentException("Cleanup requires unique nonempty record IDs.");
  return ids.Select(id=>{var item=inventory.Item(id);try{return CleanupSnapshot(item,d);}catch(InvalidOperationException e){throw new ArgumentException(e.Message,e);}}).ToArray();
 }
 CleanupOutcome[] DeleteOrphans(Guid[] ids,Document d,Dictionary<Guid,string>? reviewed=null){
  var results=new List<CleanupOutcome>();
  foreach(var id in ids){string? recovery=null;bool deletionCompleted=false;
   try{
    // Only reviewed IDs bypass inventory filtering. Test-only unreviewed calls still require membership.
    if(reviewed!=null&&!reviewed.ContainsKey(id))throw new InvalidOperationException("Record was not included in the cleanup preview.");
    var item=reviewed==null?inventory.Item(id):library.GetItemById(id)??throw new InvalidOperationException("Reviewed record no longer exists; refresh issues.");
    var snapshot=CleanupSnapshot(item,d);
    if(reviewed!=null&&CleanupFingerprint(item,snapshot)!=reviewed[id])throw new InvalidOperationException("Reviewed record type, dependencies or internal metadata changed; preview this record again.");
    var deps=inventory.Inspect(item,[],d);
    recovery=Path.Combine(storage.DirectoryPath,"recovery",clock.UtcNow.ToString("yyyyMMddTHHmmssfffffff")+"-"+id.ToString("N"));
    Directory.CreateDirectory(recovery);
    File.WriteAllText(Path.Combine(recovery,"record.json"),JsonSerializer.Serialize(new{id,item.Name,item.Path,fields=NativeMetadata.Read(item),dependencies=deps},Codec.Json));
    foreach(var p in deps.MetadataPaths){
     var target=Path.Combine(recovery,"metadata-"+Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(p))));
     foreach(var f in Directory.EnumerateFiles(p,"*",SearchOption.AllDirectories)){var dest=Path.Combine(target,Path.GetRelativePath(p,f));Directory.CreateDirectory(Path.GetDirectoryName(dest)!);File.Copy(f,dest);}
    }
    // Reload again after recovery copying so replacement and concurrent changes are inspected.
    var current=library.GetItemById(id)??throw new InvalidOperationException("Reviewed record disappeared while retaining recovery material.");
    var finalSnapshot=CleanupSnapshot(current,d);
    if(CleanupFingerprint(current,finalSnapshot)!=(reviewed?.GetValueOrDefault(id)??CleanupFingerprint(item,snapshot)))throw new InvalidOperationException("Reviewed record or internal metadata changed while retaining recovery material; preview this record again.");
    library.DeleteItem(current,new DeleteOptions{DeleteFileLocation=false,DeleteFromExternalProvider=false});
    deletionCompleted=true;
    State.DeletedRecords[id]=current.Name;State.History.Add(new(clock.UtcNow,d.Revision,id,"delete verified orphan",[]));SaveState();
    results.Add(new(id,"deleted",null,recovery));
   }catch(Exception e){
    results.Add(new(id,deletionCompleted?"deleted":e is InvalidOperationException or ArgumentException?"blocked":"failed",e.Message,recovery));
    AddReport("Cleanup "+id+": "+e.Message,id);
    try{SaveState();}catch(Exception persistError){logger.LogError(persistError,"Could not persist cleanup failure for {ItemId}",id);}
   }
  }
  return results.ToArray();
 }
}
