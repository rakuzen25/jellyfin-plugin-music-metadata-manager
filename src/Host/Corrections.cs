using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Providers;
using MediaBrowser.Controller.Dto;
using Jellyfin.Data.Enums;
using Microsoft.Extensions.Logging;

namespace MusicMetadataManager;
public sealed class Corrections(DraftService drafts, ReviewService reviews, CorrectionWriter writer, RuleProjection projection, CorrectionOperations operations, InventoryQueries queries, IssueService issues, ReportService reports)
{
    public string[] Validation(Document d) => drafts.Validation(d);
    public Task<Document> Export(CancellationToken token) => drafts.Export(token);
    public Task SaveDraft(Rule rule, CancellationToken token) => drafts.SaveDraft(rule, token);
    public Task DeleteDraft(string id, CancellationToken token) => drafts.DeleteDraft(id, token);
    public Task SaveIdentityDraft(ArtistIdentity identity, CancellationToken token) => drafts.SaveIdentityDraft(identity, token);
    public Task DeleteIdentityDraft(string id, CancellationToken token) => drafts.DeleteIdentityDraft(id, token);
    public Task Import(Document input, CancellationToken token) => drafts.Import(input, token);
    public Task SaveMetadataDraft(MetadataPolicy p, CancellationToken token) => drafts.SaveMetadataDraft(p, token);
    public Task DeleteMetadataDraft(string id, CancellationToken token) => drafts.DeleteMetadataDraft(id, token);
    public Task<DiscardResult> DiscardDrafts(DraftDiscard input, CancellationToken token) => drafts.DiscardDrafts(input, token);
    public Task<Preview> Preview(Change c, CancellationToken token) => reviews.Preview(c, token);
    public Task<ActivationResult> Activate(string token, CancellationToken cancellation) => reviews.Activate(token, cancellation);
    public Task Refresh(Guid id, CancellationToken token) => writer.Refresh(id, token);
    public Task<ItemUpdateType> Correct(BaseItem incoming, bool persist, CancellationToken token) => writer.Correct(incoming, persist, token);
    public LibraryInfo[] Libraries() => operations.Libraries();
    public Task<QueueResult> ApplyAll(CancellationToken token) => operations.ApplyAll(token);
    public Task<StatusResponse> Status(CancellationToken token) => operations.Status(token);
    public Task<RefreshWork[]> Recovery(CancellationToken token) => operations.Recovery(token);
    public Task Error(Guid id, Exception e) => operations.Error(id, e);
    public Task Missing(Guid id, CancellationToken token) => operations.Missing(id, token);
    public Task QueueManaged(CancellationToken token) => operations.QueueManaged(token);
    public Task<InventoryPage> ManagerInventory(string? search, string? libraryId, string? kind, int start, int limit, CancellationToken token) => queries.ManagerInventory(search, libraryId, kind, start, limit, token);
    public Task<ManagerDetailsResponse> ManagerDetails(Guid id, CancellationToken token) => queries.ManagerDetails(id, token);
    public Task<NavigationResponse> NativeNavigation(string? ids, string? rules, string? paths, CancellationToken token) => queries.NativeNavigation(ids, rules, paths, token);
    public Task<InventoryPage> GroupedInventory(string? search, string? libraryId, string? kind, int start, int limit, CancellationToken token) => queries.GroupedInventory(search, libraryId, kind, start, limit, token);
    public Task<AlbumTracksResponse> AlbumTracks(Guid id, CancellationToken token) => queries.AlbumTracks(id, token);
    public Task<IssueCatalogResponse> IssueCatalog(AliasService aliases, IDtoService dto, Guid userId, CancellationToken token) => issues.IssueCatalog(aliases, dto, userId, token);
    public Task<AcknowledgmentResult> AcknowledgeReports(ReportAcknowledgment input, CancellationToken token) => reports.AcknowledgeReports(input, token);
    public BaseItem[] Items() => projection.Items();
    public View Describe(BaseItem item) => projection.Describe(item);
}
