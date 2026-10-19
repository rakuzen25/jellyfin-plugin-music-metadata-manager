using System.Text.Json;
using System.Security.Cryptography;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Providers;
namespace MusicMetadataManager;
public sealed record Comparison(Guid ItemId,SourceSnapshot Snapshot,RemoteImageInfo[] Images,string[] Notes);
public sealed class SourceState {public System.Collections.Concurrent.ConcurrentDictionary<string,Comparison> Comparisons {get;set;}=[];}
public sealed class Sources(ILibraryManager library,IProviderManager providers,IHttpClientFactory http,MediaBrowser.Model.IO.IFileSystem files,MediaBrowser.Controller.Drawing.IImageProcessor imageProcessor, IPluginStorage storage, IClock clock) {
 readonly SemaphoreSlim gate=new(1,1);DateTime lastMusicBrainz;SourceState? state;
 string PathName=>Path.Combine(storage.DirectoryPath,"sources.json");
 SourceState State=>state??=File.Exists(PathName)?JsonSerializer.Deserialize<SourceState>(File.ReadAllText(PathName),Codec.Json)!:new();
 void Save(){File.WriteAllText(PathName+".tmp",JsonSerializer.Serialize(State,Codec.Json));File.Move(PathName+".tmp",PathName,true);}
 public string ImagePath(string hash)=>Path.Combine(storage.DirectoryPath,"pins",hash.ToUpperInvariant());
 public bool HasImage(string hash){var path=ImagePath(hash);if(!File.Exists(path)||Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)))!=hash.ToUpperInvariant())return false;try{ValidateImage(path);return true;}catch(ArgumentException){return false;}}
 void ValidateImage(string path){try{var size=imageProcessor.GetImageDimensions(path);if(size.Width<=0||size.Height<=0)throw new ArgumentException("Invalid image dimensions");}catch(Exception e){throw new ArgumentException("Artwork could not be decoded; select a valid JPEG, PNG or WebP image",e);}}
 public object Providers(BaseItem item){
  if(item is Person)item=new MusicArtist{Name=item.Name,ProviderIds=new(item.ProviderIds),Path=item.Path};
  return item switch {
   MusicArtist a=>providers.GetMetadataProviders<MusicArtist>(a,library.GetLibraryOptions(a),true).OfType<IRemoteMetadataProvider<MusicArtist,ArtistInfo>>().Select(x=>new{name=x.Name,key=x.Name=="MusicBrainz"?"MusicBrainzArtist":x.Name=="Apple Music"?"ITunesArtist":null}).ToArray(),
   MusicAlbum a=>providers.GetMetadataProviders<MusicAlbum>(a,library.GetLibraryOptions(a),true).OfType<IRemoteMetadataProvider<MusicAlbum,AlbumInfo>>().Select(x=>new{name=x.Name,key=x.Name=="MusicBrainz"?"MusicBrainzAlbum":x.Name=="Apple Music"?"ITunesCollection":null}).ToArray(),
   _=>Array.Empty<object>()};
 }
 public async Task<Comparison> Compare(CompareRequest request,CancellationToken token){
  if(!request.Confirm)throw new ArgumentException("Explicitly confirm this item's source record before fetching a comparison.");
  if(string.IsNullOrWhiteSpace(request.Provider)||string.IsNullOrWhiteSpace(request.Key)||string.IsNullOrWhiteSpace(request.RecordId))throw new ArgumentException("Select a provider and explicit source record ID.");
  var item=library.GetItemById(request.ItemId)??throw new ArgumentException("Item not found");
  using var timeout=CancellationTokenSource.CreateLinkedTokenSource(token);timeout.CancelAfter(TimeSpan.FromSeconds(40));
  await gate.WaitAsync(token);try{
   BaseItem? fetched=null;BaseItem detached;
   if(item is MusicArtist or Person){
    var artist=item as MusicArtist??new MusicArtist{Name=item.Name,ProviderIds=new(item.ProviderIds)};
    var info=artist.GetLookupInfo();info.ProviderIds=new(){{request.Key,request.RecordId}};
    var remote=providers.GetMetadataProviders<MusicArtist>(artist,library.GetLibraryOptions(item),true).OfType<IRemoteMetadataProvider<MusicArtist,ArtistInfo>>().SingleOrDefault(x=>x.Name==request.Provider)??throw new ArgumentException("Installed source unavailable");
    // An explicit-ID lookup validates the binding; no native Identify, refresh or persistence is invoked.
    var matches=(await remote.GetSearchResults(info,timeout.Token)).Where(x=>x.ProviderIds.TryGetValue(request.Key,out var id)&&id==request.RecordId).ToArray();
    if(matches.Length!=1)throw new ArgumentException("Source did not resolve this explicit ID uniquely; binding is not confirmed.");
    var result=await remote.GetMetadata(info,timeout.Token);if(!result.HasMetadata)throw new InvalidOperationException("Source has no metadata for the selected binding");fetched=result.Item;
    detached=new MusicArtist{Name=item.Name,ProviderIds=new(){{request.Key,request.RecordId}}};
   }else if(item is MusicAlbum album){
    var info=album.GetLookupInfo();info.ProviderIds=new(){{request.Key,request.RecordId}};
    var remote=providers.GetMetadataProviders<MusicAlbum>(album,library.GetLibraryOptions(item),true).OfType<IRemoteMetadataProvider<MusicAlbum,AlbumInfo>>().SingleOrDefault(x=>x.Name==request.Provider)??throw new ArgumentException("Installed source unavailable");
    var matches=(await remote.GetSearchResults(info,timeout.Token)).Where(x=>x.ProviderIds.TryGetValue(request.Key,out var id)&&id==request.RecordId).ToArray();if(matches.Length!=1)throw new ArgumentException("Source binding was not resolved uniquely");
    var result=await remote.GetMetadata(info,timeout.Token);if(!result.HasMetadata)throw new InvalidOperationException("Source has no metadata");fetched=result.Item;
    detached=new MusicAlbum{Name=item.Name,ProviderIds=new(){{request.Key,request.RecordId}}};
   }else throw new ArgumentException("No installed remote metadata source is available for this record type");
   var configured=NativeMetadata.Read(fetched!);var offered=new Dictionary<string,JsonElement>(configured);List<string> notes=["Provider metadata was fetched into a detached result; no native refresh or Identify was run.","Empty provider values are unavailable; approving an empty value is a separate manual decision."];
   if(request.Provider=="MusicBrainz"){
    if(!Guid.TryParse(request.RecordId,out _))throw new ArgumentException("MusicBrainz IDs must be GUIDs");
    var delay=lastMusicBrainz.AddSeconds(1.1)-clock.UtcNow;if(delay>TimeSpan.Zero)await Task.Delay(delay,timeout.Token);lastMusicBrainz=clock.UtcNow;
    var client=http.CreateClient();using var msg=new HttpRequestMessage(HttpMethod.Get,"https://musicbrainz.org/ws/2/"+(item is MusicAlbum?"release/":"artist/")+Uri.EscapeDataString(request.RecordId)+"?fmt=json");msg.Headers.UserAgent.ParseAdd("MusicMetadataManager/0.3.0 (https://github.com/jellyfin/jellyfin)");
    using var response=await client.SendAsync(msg,timeout.Token);response.EnsureSuccessStatusCode();using var raw=JsonDocument.Parse(await response.Content.ReadAsStreamAsync(timeout.Token));
    if(raw.RootElement.TryGetProperty("name",out var name))offered["title"]=name.Clone();else if(raw.RootElement.TryGetProperty("title",out name))offered["title"]=name.Clone();
    if(raw.RootElement.TryGetProperty("sort-name",out var sort))offered["sortName"]=sort.Clone();
    if(raw.RootElement.TryGetProperty("country",out var country))offered["country"]=JsonSerializer.SerializeToElement(new[]{country.GetString()});
    // Keep incomplete source dates as strings in the offered snapshot. Native date application validates completeness.
    if(raw.RootElement.TryGetProperty("life-span",out var span)){foreach(var (source,target) in new[]{("begin","premiereDate"),("end","endDate")})if(span.TryGetProperty(source,out var date)&&date.ValueKind==JsonValueKind.String){offered[target]=date.Clone();if(source=="begin"&&date.GetString() is {Length:>=4} text&&int.TryParse(text[..4],out var year)&&year>0)offered["productionYear"]=JsonSerializer.SerializeToElement(year);}}
    if(raw.RootElement.TryGetProperty("date",out var releaseDate))offered["premiereDate"]=releaseDate.Clone();
    notes.Add("Offered values include a source-specific MusicBrainz comparison; configured values reflect the installed provider and its replacement settings. MusicBrainz does not supply an artist biography.");
   }
   List<RemoteImageInfo> images=[];
   foreach(var source in providers.GetImageProviders(detached,new ImageRefreshOptions(new DirectoryService(files))).OfType<IRemoteImageProvider>().Where(x=>x.Name==request.Provider))images.AddRange(await source.GetImages(detached,timeout.Token));
   var binding=new SourceBinding{Provider=request.Provider,Key=request.Key,RecordId=request.RecordId,ConfirmedAt=clock.UtcNow};
   var snapshot=new SourceSnapshot{Binding=binding,RetrievedAt=clock.UtcNow,Configured=configured,Offered=offered};
   var comparison=new Comparison(item.Id,snapshot,images.ToArray(),notes.ToArray());State.Comparisons[snapshot.Id]=comparison;Save();return comparison;
  }finally{gate.Release();}
 }
 public async Task<ImageDecision> Cache(ImageCacheRequest request,CancellationToken token){
  await gate.WaitAsync(token);try{
   if(!State.Comparisons.TryGetValue(request.SnapshotId,out var c)||c.ItemId!=request.ItemId||!c.Images.Any(x=>x.Url==request.Url&&x.Type.ToString()==request.Type))throw new ArgumentException("Select an image offered by a confirmed comparison for this item");
   var client=http.CreateClient();using var response=await client.GetAsync(request.Url,HttpCompletionOption.ResponseHeadersRead,token);response.EnsureSuccessStatusCode();var mime=response.Content.Headers.ContentType?.MediaType;
   if(mime is not ("image/jpeg" or "image/png" or "image/webp"))throw new ArgumentException("Unsupported artwork content type");
   if(response.Content.Headers.ContentLength>25*1024*1024)throw new ArgumentException("Artwork exceeds 25 MiB");
   await using var stream=await response.Content.ReadAsStreamAsync(token);using var bytes=new MemoryStream();byte[] buffer=new byte[65536];int read;while((read=await stream.ReadAsync(buffer,token))>0){if(bytes.Length+read>25*1024*1024)throw new ArgumentException("Artwork exceeds 25 MiB");bytes.Write(buffer,0,read);}
   var data=bytes.ToArray();var hash=Convert.ToHexString(SHA256.HashData(data));Directory.CreateDirectory(Path.GetDirectoryName(ImagePath(hash))!);await File.WriteAllBytesAsync(ImagePath(hash),data,token);ValidateImage(ImagePath(hash));
   return new(){Hash=hash,Mime=mime,SnapshotId=c.Snapshot.Id,SourceUrl=request.Url};
  }finally{gate.Release();}
 }
 public async Task<ImageDecision> Upload(Stream stream,CancellationToken token){
  using var bytes=new MemoryStream();byte[] buffer=new byte[65536];int count;while((count=await stream.ReadAsync(buffer,token))>0){if(bytes.Length+count>25*1024*1024)throw new ArgumentException("Artwork exceeds 25 MiB");bytes.Write(buffer,0,count);}var data=bytes.ToArray();
  var mime=data.Length>=8&&data[0]==137&&data[1]==80&&data[2]==78&&data[3]==71?"image/png":data.Length>=12&&System.Text.Encoding.ASCII.GetString(data,0,4)=="RIFF"&&System.Text.Encoding.ASCII.GetString(data,8,4)=="WEBP"?"image/webp":data.Length>=3&&data[0]==255&&data[1]==216&&data[2]==255?"image/jpeg":null;
  if(mime is null)throw new ArgumentException("Select a JPEG, PNG or WebP image");
  var hash=Convert.ToHexString(SHA256.HashData(data));Directory.CreateDirectory(Path.GetDirectoryName(ImagePath(hash))!);await File.WriteAllBytesAsync(ImagePath(hash),data,token);ValidateImage(ImagePath(hash));return new(){Hash=hash,Mime=mime};
 }
 public ImageDecision CacheCurrent(BaseItem item,string type){
  var images=item.GetImages(Enum.Parse<ImageType>(type)).ToArray();
  if(images.Length==0)return new(){Mode="empty"};
  var path=images[0].Path;if(!File.Exists(path))throw new ArgumentException("Current image is not cached locally; select and cache a provider image first");
  var bytes=File.ReadAllBytes(path);var hash=Convert.ToHexString(SHA256.HashData(bytes));Directory.CreateDirectory(Path.GetDirectoryName(ImagePath(hash))!);File.WriteAllBytes(ImagePath(hash),bytes);ValidateImage(ImagePath(hash));
  var mime=bytes.Length>=8&&bytes[0]==137&&bytes[1]==80?"image/png":bytes.Length>=12&&System.Text.Encoding.ASCII.GetString(bytes,0,4)=="RIFF"?"image/webp":"image/jpeg";
  return new(){Hash=hash,Mime=mime};
 }
 public void ValidatePolicy(MetadataPolicy policy,IEnumerable<Guid> targets){
  var allowedTargets=targets.ToHashSet();
  foreach(var snapshot in policy.Snapshots){if(!State.Comparisons.TryGetValue(snapshot.Id,out var issued)||!allowedTargets.Contains(issued.ItemId)||Codec.Hash(issued.Snapshot)!=Codec.Hash(snapshot))throw new ArgumentException("Imported source snapshots require a new confirmed comparison for their target before activation");}
  foreach(var field in policy.Fields.Values.Where(x=>x.SnapshotId is not null&&x.Mode=="approved")){
   var source=policy.Snapshots.SingleOrDefault(x=>x.Id==field.SnapshotId)??throw new ArgumentException("Missing source snapshot");if(field.SourceField is null||!source.Offered.TryGetValue(field.SourceField,out var offered)||!Engine.Equal(offered,field.Value))throw new ArgumentException("Approved provider value does not match its source snapshot");
  }
  foreach(var image in policy.Images.Values.Where(x=>x.Mode=="approved")){
   if(!HasImage(image.Hash!))throw new ArgumentException("Approved artwork is missing or its hash changed; cache and preview it again");
   if(image.SnapshotId is not null&&(!policy.Snapshots.Any(s=>s.Id==image.SnapshotId)||!State.Comparisons.TryGetValue(image.SnapshotId,out var issued)||!issued.Images.Any(i=>i.Url==image.SourceUrl)))throw new ArgumentException("Artwork source requires its confirmed comparison snapshot");
  }
  foreach(var snapshot in policy.Snapshots)if(!policy.Bindings.Any(x=>Codec.Hash(x)==Codec.Hash(snapshot.Binding)))throw new ArgumentException("Confirm each snapshot's provider binding");
 }
}
