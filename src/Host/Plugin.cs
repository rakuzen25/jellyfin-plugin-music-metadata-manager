using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace MusicMetadataManager;
public sealed class Configuration : BasePluginConfiguration
{
}

public sealed class Plugin : BasePlugin<Configuration>, IHasWebPages
{
    public static Plugin Instance { get; private set; } = null!;
    public string StatePath { get; }

    public Plugin(IApplicationPaths paths, IXmlSerializer serializer) : base(paths, serializer)
    {
        Instance = this;
        StatePath = Path.Combine(paths.DataPath, "MusicMetadataManager");
        Directory.CreateDirectory(StatePath);
    }

    public override string Name => "Music Metadata Manager";
    public override Guid Id => Guid.Parse("86400cc2-d51e-4695-82c0-5d4f61d3a1f7");

    public override void UpdateConfiguration(BasePluginConfiguration configuration) => throw new ArgumentException("Use the Music Metadata Manager editor and preview workflow to change rules.");
    public IEnumerable<PluginPageInfo> GetPages() => [new()
    {
        Name = "musicmetadatamanager",
        EmbeddedResourcePath = "Jellyfin.Plugin.MusicMetadataManager.Web.config.html"
    }

    ];
}

public sealed class Registration : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection services, IServerApplicationHost host)
    {
        services.AddSingleton(_ => Plugin.Instance);
        services.AddSingleton<StateCoordinator>();
        services.AddSingleton<IDocumentReader>(s => s.GetRequiredService<StateCoordinator>());
        services.AddSingleton<IPluginStorage>(_ => new PluginStorage(Plugin.Instance.StatePath));
        services.AddSingleton<IStateStore, JsonStateStore>();
        services.AddSingleton<IClock, SystemClock>();
        services.AddSingleton<IRefreshQueue, RefreshQueue>();
        services.AddSingleton<AliasService>();
        services.AddHostedService(s => s.GetRequiredService<AliasService>());
        services.AddSingleton<AliasAdapter>();
        services.AddSingleton<Microsoft.Extensions.Options.IConfigureOptions<Microsoft.AspNetCore.Mvc.MvcOptions>, AliasMvcOptions>();
        services.AddSingleton<Inventory>();
        services.AddSingleton<IMusicInventory>(s => s.GetRequiredService<Inventory>());
        services.AddSingleton<PinnedImages>();
        services.AddSingleton<ArtworkService>();
        services.AddSingleton<ISourceLookup, SourceLookup>();
        services.AddSingleton<SourceComparisons>();
        services.AddSingleton<Sources>();
        services.AddSingleton<ILibraryCatalog, LibraryCatalog>();
        services.AddSingleton<IIdentityBindings, IdentityBindings>();
        services.AddSingleton<DocumentValidator>();
        services.AddSingleton<ReviewSessions>();
        services.AddSingleton<DraftService>();
        services.AddSingleton<CandidateBuilder>();
        services.AddSingleton<ReportService>();
        services.AddSingleton<ReconciliationService>();
        services.AddSingleton<RuleProjection>();
        services.AddSingleton<MetadataPolicies>();
        services.AddSingleton<ReviewProjection>();
        services.AddSingleton<MetadataReconciler>();
        services.AddSingleton<ReviewedCleanup>();
        services.AddSingleton<InventoryQueries>();
        services.AddSingleton<IssueService>();
        services.AddSingleton<CorrectionWriter>();
        services.AddSingleton<CorrectionOperations>();
        services.AddSingleton<ReviewService>();
        services.AddSingleton<IMetadataPolicyEditor>(s => s.GetRequiredService<MetadataPolicies>());
        services.AddSingleton<IReviewProjection>(s => s.GetRequiredService<ReviewProjection>());
        services.AddSingleton<IRestorationService>(s => s.GetRequiredService<MetadataReconciler>());
        services.AddSingleton<IReviewedCleanup>(s => s.GetRequiredService<ReviewedCleanup>());
        services.AddSingleton<Corrections>();
        services.AddSingleton<Worker>();
        services.AddHostedService(s => s.GetRequiredService<Worker>());
    }
}
