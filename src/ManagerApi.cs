using Jellyfin.Api.Extensions;
using MediaBrowser.Controller.Dto;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace MusicMetadataManager;
[ApiController,Authorize(Roles="Administrator"),Route("MusicMetadataManager/manager"),TypeFilter(typeof(ApiErrors))]
public sealed class ManagerApi(Corrections corrections,Inventory inventory,Sources sources,AliasService aliases):ControllerBase {
 IActionResult Data(object? value)=>new JsonResult(value,Codec.Json);
 [HttpGet("inventory")]public async Task<IActionResult> List(string? search,string? library,string? kind,int start=0,int limit=50,string view="native",CancellationToken token=default)=>Data(view=="grouped"?await corrections.GroupedInventory(search,library,kind,start,limit,token):view=="native"?await corrections.ManagerInventory(search,library,kind,start,limit,token):throw new ArgumentException("Inventory view must be native or grouped"));
 [HttpGet("items/{id}/tracks")]public async Task<IActionResult> Tracks(Guid id,CancellationToken token)=>Data(await corrections.AlbumTracks(id,token));
 [HttpGet("images/pins/{hash}")]public IActionResult Pin(string hash){
  if(hash.Length!=64||hash.Any(c=>!Uri.IsHexDigit(c))||!sources.HasImage(hash))return NotFound();
  var bytes=System.IO.File.ReadAllBytes(sources.ImagePath(hash));
  var mime=bytes[0]==137?"image/png":bytes.Length>=12&&System.Text.Encoding.ASCII.GetString(bytes,0,4)=="RIFF"?"image/webp":"image/jpeg";
  Response.Headers.CacheControl="private, no-store";return File(bytes,mime);
 }
 [HttpGet("items/{id}")]public async Task<IActionResult> Details(Guid id,CancellationToken token)=>Data(await corrections.ManagerDetails(id,token));
 [HttpPost("drafts")]public async Task<IActionResult> Draft(MetadataPolicy p,CancellationToken token){await corrections.SaveMetadataDraft(p,token);return Data(new{saved=p.Id});}
 [HttpDelete("drafts/{id}")]public async Task<IActionResult> DeleteDraft(string id,CancellationToken token){await corrections.DeleteMetadataDraft(id,token);return Data(new{deleted=id});}
 [HttpPost("compare")]public async Task<IActionResult> Compare(CompareRequest request,CancellationToken token){inventory.Item(request.ItemId);return Data(await sources.Compare(request,token));}
 [HttpPost("images/upload"),RequestSizeLimit(26214400)]public async Task<IActionResult> Upload([FromForm] Microsoft.AspNetCore.Http.IFormFile file,CancellationToken token){await using var stream=file.OpenReadStream();return Data(await sources.Upload(stream,token));}
 [HttpPost("images/cache")]public async Task<IActionResult> Cache(ImageCacheRequest request,CancellationToken token)=>Data(await sources.Cache(request,token));
 [HttpPost("items/{id}/images/{type}/pin-current")]public IActionResult CurrentImage(Guid id,string type)=>Data(sources.CacheCurrent(inventory.Item(id),type));
 [HttpGet("items/{id}/dependencies")]public IActionResult Dependencies(Guid id,[FromQuery]string[] libraries)=>Data(inventory.Inspect(inventory.Item(id),libraries));
 [HttpPost("errors/acknowledge")]public async Task<IActionResult> Acknowledge(ReportAcknowledgment input,CancellationToken token)=>Data(await corrections.AcknowledgeReports(input,token));
 [HttpGet("issues")]public async Task<IActionResult> Issues([FromServices]IDtoService dto,CancellationToken token)=>Data(await corrections.IssueCatalog(aliases,dto,HttpContext.User.GetUserId(),token));
}
