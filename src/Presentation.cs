using MediaBrowser.Controller.Entities.Audio;
using System.Text.Json;
namespace MusicMetadataManager;

// Administrator presentation projections. These never change the native library.
public sealed record NavigationPath(string Key,string Path,string Kind);
public sealed record InventoryRecord(Guid Id,string Name,string Kind,string? Path,bool Representative);
public sealed record InventoryEntry(Guid Id,string Name,string Kind,string? Path,string Library,bool Managed,string? IdentityId,string[] Aliases,InventoryRecord[] Records,bool MissingBinding);
public sealed partial class Corrections {
 public async Task<object> NativeNavigation(string? ids,string? rules,string? paths,CancellationToken token){
  var requestedIds=(ids??"").Split(',',StringSplitOptions.RemoveEmptyEntries);
  var requestedRules=(rules??"").Split(',',StringSplitOptions.RemoveEmptyEntries);
  if(requestedIds.Length>100||requestedRules.Length>100)throw new ArgumentException("Request at most 100 item and rule destinations");
  if(requestedIds.Any(x=>!Guid.TryParse(x,out _)))throw new ArgumentException("Invalid native item ID");
  NavigationPath[] requestedPaths;
  try{requestedPaths=string.IsNullOrEmpty(paths)?[]:JsonSerializer.Deserialize<NavigationPath[]>(paths,Codec.Json)??[];}catch(JsonException){throw new ArgumentException("Invalid path destinations");}
  if(requestedPaths.Length>20||requestedPaths.Any(x=>x is null||x.Kind is not ("track" or "album")||string.IsNullOrEmpty(x.Path)||!x.Path.StartsWith('/')||x.Key!=x.Kind+":"+x.Path))throw new ArgumentException("Invalid path destinations");
  await gate.WaitAsync(token);
  try{
   var items=requestedIds.Distinct().ToDictionary(x=>x,x=>library.GetItemById(Guid.Parse(x)) is {} item ? (object)new{id=item.Id,name=item.Name} : null);
   var targets=new Dictionary<string,object?>();
   var definitions=Doc.Active.Concat(Doc.Drafts).ToArray();
   var records=requestedRules.Length>0||requestedPaths.Length>0 ? inventory.Records() : [];
   foreach(var key in requestedRules.Distinct()){
    var rule=definitions.FirstOrDefault(x=>x.Id==key);
    var matches=rule is null||rule.Kind=="alias" ? [] : records.Where(x=>x.Path==rule.Path&&(rule.Kind=="album" ? x is MusicAlbum : x is Audio)).ToArray();
    targets[key]=matches.Length==1 ? new{id=matches[0].Id,name=matches[0].Name} : null;
   }
   var pathTargets=new Dictionary<string,object?>();
   foreach(var target in requestedPaths){
    var matches=records.Where(x=>x.Path==target.Path&&(target.Kind=="album" ? x is MusicAlbum : x is Audio)).ToArray();
    pathTargets[target.Key]=matches.Length==1 ? new{id=matches[0].Id,name=matches[0].Name} : null;
   }
   return new{items,rules=targets,paths=pathTargets};
  }finally{gate.Release();}
 }
 public async Task<object> GroupedInventory(string? search,string? libraryId,string? kind,int start,int limit,CancellationToken token){
  await gate.WaitAsync(token);
  try {
   if(start<0||limit<1||limit>200)throw new ArgumentException("Use a nonnegative start and limit 1–200");
   var records=inventory.Records();var byId=records.ToDictionary(x=>x.Id);
   var rows=new List<InventoryEntry>();var grouped=new HashSet<Guid>();
   bool Matches(IEnumerable<string?> names)=>string.IsNullOrWhiteSpace(search)||names.Any(n=>n!=null&&IdentityEngine.Key(n).Contains(IdentityEngine.Key(search),StringComparison.Ordinal));
   if(kind is null or "" or "artist" or "identity")foreach(var identity in Doc.Identities.Where(i=>libraryId is null||i.Libraries.Contains(libraryId))){
    var links=identity.Records.Where(byId.ContainsKey).Select(id=>byId[id]).ToArray();
    foreach(var id in identity.Records)grouped.Add(id);
    if(!Matches(identity.Names.Concat(links.SelectMany(x=>new[]{x.Name,x.Path}))))continue;
    rows.Add(new(identity.ArtistId,identity.PreferredName,"identity",null,"",links.Any(x=>State.Metadata.ContainsKey(x.Id)||State.Items.ContainsKey(x.Id)),identity.Id,identity.Aliases,links.Select(x=>new InventoryRecord(x.Id,x.Name,x.GetType().Name,x.Path,x.Id==identity.ArtistId||x.Id==identity.PersonId)).ToArray(),!byId.ContainsKey(identity.ArtistId)||!byId.ContainsKey(identity.PersonId)));
   }
   foreach(var item in records){
    if(grouped.Contains(item.Id)||kind=="identity")continue;
    var itemKind=item is Audio?"track":item is MusicAlbum?"album":item.GetType().Name;
    if(!string.IsNullOrEmpty(kind)&&kind!=itemKind&&!(kind=="artist"&&itemKind is "MusicArtist" or "Person"))continue;
    var scope=inventory.Scope(item);
    if(libraryId!=null&&scope.Id!=libraryId&&!(itemKind is "MusicArtist" or "Person"&&inventory.Inspect(item,[libraryId]).Music.Any(x=>x.Library==libraryId)))continue;
    if(!Matches([item.Name,item.Path]))continue;
    rows.Add(new(item.Id,item.Name,itemKind,item.Path,scope.Id,State.Metadata.ContainsKey(item.Id)||State.Items.ContainsKey(item.Id),null,[],[],false));
   }
   var sorted=rows.OrderBy(x=>x.Name,StringComparer.OrdinalIgnoreCase).ThenBy(x=>x.Kind,StringComparer.Ordinal).ThenBy(x=>x.Id).ToArray();
   return new{total=sorted.Length,start,limit,items=sorted.Skip(start).Take(limit).ToArray(),view="grouped"};
  }finally{gate.Release();}
 }
 public async Task<object> AlbumTracks(Guid id,CancellationToken token){
  await gate.WaitAsync(token);
  try {
   if(inventory.Item(id) is not MusicAlbum album)throw new ArgumentException("Select an album to list its tracks");
   var rows=inventory.Records().OfType<Audio>().Where(x=>x.ParentId==album.Id)
    .OrderBy(x=>x.ParentIndexNumber??1).ThenBy(x=>x.IndexNumber??int.MaxValue).ThenBy(x=>x.Name,StringComparer.OrdinalIgnoreCase).ThenBy(x=>x.Id)
    .Select(x=>new{id=x.Id,name=x.Name,discNumber=x.ParentIndexNumber,trackNumber=x.IndexNumber,artists=x.Artists,path=x.Path,managed=State.Items.ContainsKey(x.Id)}).ToArray();
   return new{albumId=id,total=rows.Length,items=rows};
  }finally{gate.Release();}
 }
}
