using System.Net;
using System.Text;
using System.Text.Json;
using MediaBrowser.Model.Dto;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Xunit;

namespace MusicMetadataManager.Tests;
public sealed class PlaybackBoundaryTests
{
    [Fact]
    public async Task IdentityPresentationLeavesPlaybackCreditsAndCapturedScrobblePayloadUnchanged()
    {
        var native = new BaseItemDto
        {
            Id = Guid.NewGuid(),
            Name = "Fixture track",
            Artists = ["Fixture artist"],
            AlbumArtists = [new()
            {
                Name = "Fixture album artist",
                Id = Guid.NewGuid()
            }

            ]
        };
        var arguments = new Dictionary<string, object?>
        {
            ["itemId"] = native.Id,
            ["item"] = native
        };
        var controller = new PlaystateController();
        var action = new ActionContext(new DefaultHttpContext(), new RouteData(), new ActionDescriptor());
        var context = new ActionExecutingContext(action, [], arguments, controller);
        var called = false;
        var filter = new AliasAdapter(null!, null!, null!, new Configuration());
        await filter.OnActionExecutionAsync(context, () =>
        {
            called = true;
            return Task.FromResult(new ActionExecutedContext(action, [], controller) { Result = new JsonResult(native) });
        });
        Assert.True(called);
        Assert.Same(native, arguments["item"]);
        Assert.Equal(["Fixture artist"], native.Artists);
        using var capture = new Capture();
        using var client = new HttpClient(capture);
        using var response = await client.PostAsync("https://scrobble.invalid/fixture", new StringContent(JsonSerializer.Serialize(native, Codec.Json), Encoding.UTF8, "application/json"), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var payload = JsonDocument.Parse(capture.Body!);
        Assert.Equal("Fixture artist", payload.RootElement.GetProperty("artists")[0].GetString());
        Assert.Equal("Fixture album artist", payload.RootElement.GetProperty("albumArtists")[0].GetProperty("name").GetString());
        Assert.DoesNotContain("Preferred overlay", capture.Body);
    }

    sealed class PlaystateController;
    sealed class Configuration : IDocumentReader
    {
        public Document Current { get; } = new()
        {
            Identities = [new()
            {
                PreferredName = "Preferred overlay",
                Aliases = ["Fixture artist"]
            }

            ]
        };

        public void Save(Document document) => throw new InvalidOperationException("Playback must not save configuration");
    }

    sealed class Capture : HttpMessageHandler
    {
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new(HttpStatusCode.OK);
        }
    }
}
