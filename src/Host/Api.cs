using Microsoft.AspNetCore.Authorization;
using Jellyfin.Api.Extensions;
using MediaBrowser.Controller.Dto;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace MusicMetadataManager;
public sealed class ApiErrors : IExceptionFilter
{
    public void OnException(ExceptionContext context)
    {
        var error = context.Exception;
        if (error is OperationCanceledException && context.HttpContext.RequestAborted.IsCancellationRequested)
            return;
        var status = error switch
        {
            HttpRequestException => 502,
            OperationCanceledException => 504,
            ArgumentException => 400,
            InvalidOperationException => 409,
            IOException => 503,
            UnauthorizedAccessException => 503,
            _ => 0
        };
        if (status == 0)
            return;
        var message = error is HttpRequestException ? "Source lookup unavailable. Retry the comparison." : error is OperationCanceledException ? "The operation timed out. Check status before repeating a write." : error is IOException or UnauthorizedAccessException ? "Plugin storage is unavailable. Check status before retrying." : error.Message;
        context.Result = new JsonResult(new ApiError(FailureCodes.For(error), message, (error as RuleConflictException)?.RuleIds), Codec.Json)
        {
            StatusCode = status
        };
        context.ExceptionHandled = true;
    }
}

[ApiController, Authorize(Roles = "Administrator"), Route("MusicMetadataManager"), TypeFilter(typeof(ApiErrors))]
public sealed class Api(Corrections corrections, AliasService aliases) : ControllerBase
{
    [HttpGet("manager/navigation")]
    public async Task<IActionResult> NativeNavigation([FromQuery] string? ids, [FromQuery] string? rules, [FromQuery] string? paths, CancellationToken token) => Data(await corrections.NativeNavigation(ids, rules, paths, token));
    IActionResult Data(object? value) => new JsonResult(value, Codec.Json);
    [HttpGet("libraries")]
    public IActionResult Libraries() => Data(corrections.Libraries());
    [HttpGet("items")]
    public IActionResult Items([FromQuery] string? search, [FromQuery] string? library) => Data(corrections.Items().Select(corrections.Describe).Where(x => (library == null || x.Library == library) && (search == null || x.Path.Contains(search, StringComparison.OrdinalIgnoreCase) || x.Values["title"].ToString().Contains(search, StringComparison.OrdinalIgnoreCase))).Take(300).ToArray());
    [HttpGet("rules")]
    public async Task<IActionResult> Rules(CancellationToken token) => Data(await corrections.Export(token));
    [HttpGet("export")]
    public async Task<IActionResult> Export(CancellationToken token) => Data(await corrections.Export(token));
    [HttpPost("drafts")]
    public async Task<IActionResult> Save([FromBody] Rule rule, CancellationToken token)
    {
        await corrections.SaveDraft(rule, token);
        return Data(new SaveResult(rule.Id));
    }

    [HttpDelete("drafts/{id}")]
    public async Task<IActionResult> DeleteDraft(string id, CancellationToken token)
    {
        await corrections.DeleteDraft(id, token);
        return Data(new DeleteResult(id));
    }

    [HttpPost("drafts/discard")]
    public async Task<IActionResult> DiscardDrafts([FromBody] DraftDiscard input, CancellationToken token) => Data(await corrections.DiscardDrafts(input, token));
    [HttpPost("import")]
    public async Task<IActionResult> Import([FromBody] Document doc, CancellationToken token)
    {
        await corrections.Import(doc, token);
        return Data(new ImportResult(true));
    }

    [HttpPost("validate")]
    public IActionResult Validate([FromBody] Document doc) => Data(new ValidationResult(corrections.Validation(doc)));
    [HttpPost("preview")]
    public async Task<IActionResult> Preview([FromBody] Change change, CancellationToken token) => Data(await corrections.Preview(change, token));
    [HttpPost("activate")]
    public async Task<IActionResult> Activate([FromBody] Activation input, CancellationToken token) => Data(await corrections.Activate(input.Token, token));
    [HttpPost("apply")]
    public async Task<IActionResult> Apply(CancellationToken token) => Data(await corrections.ApplyAll(token));
    [HttpPost("identities/drafts")]
    public async Task<IActionResult> SaveIdentity([FromBody] ArtistIdentity identity, CancellationToken token)
    {
        await corrections.SaveIdentityDraft(identity, token);
        return Data(new SaveResult(identity.Id));
    }

    [HttpDelete("identities/drafts/{id}")]
    public async Task<IActionResult> DeleteIdentity(string id, CancellationToken token)
    {
        await corrections.DeleteIdentityDraft(id, token);
        return Data(new DeleteResult(id));
    }

    [HttpGet("identities/unresolved")]
    public IActionResult Unresolved([FromServices] IDtoService dto) => Data(aliases.Unresolved(aliases.User(HttpContext.User.GetUserId()) ?? throw new InvalidOperationException("Authenticated user required."), dto));
    [HttpGet("identities/records")]
    public IActionResult IdentityRecords() => Data(aliases.Records());
    [HttpGet("identities/names")]
    public IActionResult IdentityNames() => Data(aliases.LocalNames());
    [HttpGet("identities/suggestions")]
    public async Task<IActionResult> IdentitySuggestions([FromQuery] string mbid, CancellationToken token) => Data(await aliases.Suggestions(mbid, token));
    [HttpGet("identities/status")]
    public IActionResult IdentityStatus() => Data(aliases.Status());
    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken token) => Data(await corrections.Status(token));
}
