using MusicMetadataManager;
using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Reflection;
using Xunit;

namespace MusicMetadataManager.Tests;
public sealed class PublicContractTests
{
    [Fact]
    public void RuntimeIdentityAndSettingsPageRemainStable()
    {
        var plugin = (Plugin)RuntimeHelpers.GetUninitializedObject(typeof(Plugin));
        Assert.Equal(Guid.Parse("86400cc2-d51e-4695-82c0-5d4f61d3a1f7"), plugin.Id);
        Assert.Equal("Music Metadata Manager", plugin.Name);
        Assert.Equal("musicmetadatamanager", Assert.Single(plugin.GetPages()).Name);
        Assert.Equal("Jellyfin.Plugin.MusicMetadataManager", typeof(Plugin).Assembly.GetName().Name);
    }

    [Theory]
    [InlineData(typeof(Api), "MusicMetadataManager")]
    [InlineData(typeof(ManagerApi), "MusicMetadataManager/manager")]
    public void AdministratorRoutesRemainStable(Type controller, string route)
    {
        Assert.Equal(route, controller.GetCustomAttribute<RouteAttribute>()!.Template);
        Assert.Equal("Administrator", controller.GetCustomAttribute<AuthorizeAttribute>()!.Roles);
    }
}
