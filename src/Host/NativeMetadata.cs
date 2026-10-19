using System.Text.Json;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Model.Entities;
namespace MusicMetadataManager;
public static class NativeMetadata {
 public static Dictionary<string,JsonElement> Read(BaseItem item) {
  Dictionary<string,object?> values=new(){["title"]=item.Name,["sortName"]=item.ForcedSortName,["overview"]=item.Overview,["genres"]=item.Genres,["tags"]=item.Tags,["country"]=item.ProductionLocations,["premiereDate"]=item.PremiereDate?.ToString("yyyy-MM-dd"),["endDate"]=item.EndDate?.ToString("yyyy-MM-dd"),["productionYear"]=item.ProductionYear,["providerIds"]=item.ProviderIds,["lockedFields"]=item.LockedFields.Select(x=>x.ToString()).ToArray(),["isLocked"]=item.IsLocked};
  if(item is Audio t){values["album"]=t.Album;values["artists"]=t.Artists;values["albumArtists"]=t.AlbumArtists;values["discNumber"]=t.ParentIndexNumber;values["trackNumber"]=t.IndexNumber;}
  else if(item is MusicAlbum a){values["artists"]=a.Artists;values["albumArtists"]=a.AlbumArtists;}
  return values.ToDictionary(x=>x.Key,x=>JsonSerializer.SerializeToElement(x.Value,Codec.Json));
 }
 public static void Write(BaseItem item,string field,JsonElement value){
  switch(field){
   case "title":item.Name=value.GetString()!;break;
   case "sortName":item.ForcedSortName=value.ValueKind==JsonValueKind.Null?null:value.GetString();break;
   case "overview":item.Overview=value.ValueKind==JsonValueKind.Null?null:value.GetString();break;
   case "genres":item.Genres=value.Deserialize<string[]>()??[];break;
   case "tags":item.Tags=value.Deserialize<string[]>()??[];break;
   case "country":item.ProductionLocations=value.Deserialize<string[]>()??[];break;
   case "productionYear":item.ProductionYear=value.Deserialize<int?>();break;
   case "premiereDate":item.PremiereDate=value.ValueKind==JsonValueKind.Null?null:DateTime.SpecifyKind(DateOnly.ParseExact(value.GetString()!,"yyyy-MM-dd").ToDateTime(TimeOnly.MinValue),DateTimeKind.Utc);break;
   case "endDate":item.EndDate=value.ValueKind==JsonValueKind.Null?null:DateTime.SpecifyKind(DateOnly.ParseExact(value.GetString()!,"yyyy-MM-dd").ToDateTime(TimeOnly.MinValue),DateTimeKind.Utc);break;
   case "providerIds":item.ProviderIds=value.Deserialize<Dictionary<string,string>>()??[];break;
   case "lockedFields":item.LockedFields=(value.Deserialize<string[]>()??[]).Select(Enum.Parse<MetadataField>).ToArray();break;
   case "isLocked":item.IsLocked=value.GetBoolean();break;
   default:throw new ArgumentException("Unsupported native field: "+field);
  }
 }
}
