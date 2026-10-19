using Jellyfin.Api.Extensions;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Querying;
using MediaBrowser.Model.Search;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;
namespace MusicMetadataManager;

public sealed class AliasMvcOptions : IConfigureOptions<MvcOptions>
{
    public void Configure(MvcOptions options) => options.Filters.AddService<AliasAdapter>();
}
public sealed class AliasAdapter(AliasService aliases, ILibraryManager library, IDtoService dto, IConfigurationStore configuration) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext c, ActionExecutionDelegate next)
    {
        var controller = c.Controller.GetType().Name;
        if (controller is not ("ItemsController" or "UserLibraryController" or "ArtistsController" or "PersonsController" or "SearchController"))
        {
            await next();
            return;
        }
        if (configuration.Current.Identities.Count == 0)
        {
            await next();
            return;
        }
        var args = c.ActionArguments;
        Guid? ArgId(string key) => args.TryGetValue(key, out var v) && v is Guid id ? id : null;
        var authenticated = c.HttpContext.User.GetUserId();
        var requested = ArgId("userId");
        if (requested.HasValue && requested.Value != authenticated && !c.HttpContext.User.IsInRole("Administrator"))
        {
            await next();
            return;
        }
        var user = aliases.User(requested ?? authenticated);
        if (user is null)
        {
            await next();
            return;
        }
        var views = aliases.Views(user, ArgId("parentId"));
        if (views.Length == 0)
        {
            await next();
            return;
        }
        var itemId = ArgId("itemId");
        var requestIdentity = itemId.HasValue ? aliases.ForId(itemId.Value, views) : null;
        var path = c.HttpContext.Request.Path.Value ?? "";
        if (requestIdentity is not null && (path.Contains("FavoriteItems", StringComparison.OrdinalIgnoreCase)))
        {
            if (c.HttpContext.Request.Method is "POST" or "DELETE")
            {
                var data = await aliases.SetFavorite(user, requestIdentity, c.HttpContext.Request.Method == "POST", c.HttpContext.RequestAborted);
                c.Result = new OkObjectResult(data);
                return;
            }
        }
        // Preserve native access, DTO options, and route validation when redirecting linked record IDs.
        if (requestIdentity is not null && c.HttpContext.Request.Method == "GET")
            args["itemId"] = library.GetItemById(itemId!.Value) is MediaBrowser.Controller.Entities.Person ? requestIdentity.Identity.PersonId : requestIdentity.Identity.ArtistId;
        if (controller == "PersonsController" && args.TryGetValue("name", out var requestedName) && requestedName is string credit)
        {
            var view = views.FirstOrDefault(v => IdentityEngine.Matches(v.Identity, credit));
            if (view is not null)
                args["name"] = library.GetItemById(view.Identity.PersonId)!.Name;
        }
        // Expand native artist filters into a concrete union of media IDs. Other native filters still run.
        if (controller == "ItemsController" && args.ContainsKey("ids"))
        {
            HashSet<Guid>? matched = null;
            foreach (var key in new[] { "artistIds", "albumArtistIds", "contributingArtistIds", "personIds" })
            {
                if (!args.TryGetValue(key, out var raw) || raw is not Guid[] ids || ids.Length == 0 || !ids.Any(id => aliases.ForId(id, views) is not null))
                    continue;
                var expanded = new HashSet<Guid>();
                foreach (var id in ids)
                {
                    var view = aliases.ForId(id, views);
                    if (view is not null)
                    {
                        var roles = key == "albumArtistIds" ? view.Members.Where(x => x.AlbumArtists.Any(n => IdentityEngine.Matches(view.Identity, n))) : view.Members;
                        expanded.UnionWith(roles.Select(x => x.Id));
                    }
                }
                var native = new InternalItemsQuery(user) { Recursive = true };
                if (key == "personIds")
                    native.PersonIds = ids;
                else if (key == "albumArtistIds")
                    native.AlbumArtistIds = ids;
                else if (key == "contributingArtistIds")
                    native.ContributingArtistIds = ids;
                else
                    native.ArtistIds = ids;
                library.ConfigureUserAccess(native, user);
                expanded.UnionWith(library.GetItemList(native).Select(x => x.Id));
                if (matched is null)
                    matched = expanded;
                else
                    matched.IntersectWith(expanded);
                args[key] = Array.Empty<Guid>();
            }
            if (matched is not null)
            {
                if (args["ids"] is Guid[] prior && prior.Length > 0)
                    matched.IntersectWith(prior);
                // Empty ItemIds means unrestricted in Jellyfin, so use an impossible ID for no matches.
                args["ids"] = matched.Count == 0 ? [Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff")] : matched.ToArray();
            }
        }
        bool listing = controller is "ArtistsController" or "PersonsController";
        bool hint = controller == "SearchController";
        bool itemListing = controller == "ItemsController" && args.ContainsKey("startIndex");
        var start = args.TryGetValue("startIndex", out var rawStart) && rawStart is int n ? n : 0;
        var limit = args.TryGetValue("limit", out var rawLimit) && rawLimit is int l ? l : (int?)null;
        var term = args.TryGetValue("searchTerm", out var rawTerm) ? rawTerm as string : null;
        bool favoriteRequested = args.TryGetValue("isFavorite", out var fav) && fav is bool;
        bool? favorite = fav as bool?;
        bool favoriteFilter = args.TryGetValue("filters", out var fs) && fs is ItemFilter[] filters && filters.Contains(ItemFilter.IsFavorite);
        if (listing || hint || itemListing)
        {
            if (args.ContainsKey("startIndex"))
                args["startIndex"] = 0;
            if (args.ContainsKey("limit"))
                args["limit"] = null;
            // Artist-name search and favorites are evaluated after identity collapse.
            if (listing)
            {
                if (args.ContainsKey("searchTerm"))
                    args["searchTerm"] = null;
                if (favoriteRequested)
                    args["isFavorite"] = null;
                if (favoriteFilter)
                    args["filters"] = ((ItemFilter[])fs!).Where(x => x != ItemFilter.IsFavorite).ToArray();
            }
        }
        if (listing)
        {
            var eligible = new InternalItemsQuery(user) { Recursive = true, IncludeItemTypes = [BaseItemKind.Audio, BaseItemKind.MusicAlbum] };
            if (ArgId("parentId") is Guid parent && parent != Guid.Empty)
                eligible.ParentId = parent;
            foreach (var key in args.Keys.Where(k => k is not ("userId" or "parentId" or "startIndex" or "limit" or "searchTerm" or "isFavorite" or "filters" or "sortBy" or "sortOrder" or "nameStartsWith" or "nameStartsWithOrGreater" or "nameLessThan")))
            {
                if (!args.TryGetValue(key, out var value) || value is null || value is Array ar && ar.Length == 0)
                    continue;
                var property = typeof(InternalItemsQuery).GetProperties().FirstOrDefault(p => p.Name.Equals(key, StringComparison.OrdinalIgnoreCase));
                if (property?.CanWrite == true && property.PropertyType.IsInstanceOfType(value))
                    property.SetValue(eligible, value);
            }
            library.ConfigureUserAccess(eligible, user);
            var ids = library.GetItemList(eligible).Select(x => x.Id).ToHashSet();
            views = views.Select(v => new AliasView(v.Identity, v.Members.Where(m => ids.Contains(m.Id)).ToArray())).Where(v => v.Members.Length > 0).ToArray();
            if (args.TryGetValue("personTypes", out var kinds) && kinds is string[] types && types.Length > 0 && !types.Any(x => x is "Artist" or "AlbumArtist"))
                views = [];
            if (args.TryGetValue("excludePersonTypes", out var excluded) && excluded is string[] exclusions && exclusions.Contains("Artist") && exclusions.Contains("AlbumArtist"))
                views = [];
        }
        var result = await next();
        if (result.Exception is not null && !result.ExceptionHandled)
            return;
        if (result.Result is not ObjectResult response)
            return;
        if (response.Value is BaseItemDto single)
        {
            aliases.Overlay(single, user, views);
            return;
        }
        if (response.Value is QueryResult<BaseItemDto> collection)
        {
            var values = collection.Items.ToList();
            // Native artist lists can omit a renamed artist record entirely. Add a representative
            // only when this identity has accessible matching media under the native role/type filters.
            if (listing)
            {
                var person = controller == "PersonsController";
                foreach (var view in views)
                {
                    if (args.TryGetValue("appearsInItemId", out var appears) && appears is Guid appearsId && !view.Members.Any(x => x.Id == appearsId))
                        continue;
                    if (path.Contains("AlbumArtists", StringComparison.OrdinalIgnoreCase) && !view.Members.Any(x => x.AlbumArtists.Any(name => IdentityEngine.Matches(view.Identity, name))))
                        continue;
                    var bound = view.Identity.Records;
                    if (values.Any(x => bound.Contains(x.Id)))
                        continue;
                    // Respect additional native restrictions by requiring a bound result when filters beyond
                    // name/favorite/role/page options narrow this collection.

                    values.Add(aliases.Representative(view, person, dto, user));
                }
            }
            var seen = new HashSet<string>();
            var collapsed = new List<BaseItemDto>();
            foreach (var value in values)
            {
                var identity = aliases.ForId(value.Id, views);
                if (identity is not null)
                {
                    if (!seen.Add(identity.Identity.Id))
                        continue;
                    var representative = aliases.Representative(identity, value.Type == BaseItemKind.Person, dto, user);
                    if (listing && !string.IsNullOrWhiteSpace(term) && IdentityEngine.SearchScore(identity.Identity, term) == 0)
                        continue;
                    if (listing && (favoriteRequested || favoriteFilter) && aliases.Favorite(user, identity) != (favorite ?? true))
                        continue;
                    collapsed.Add(representative);
                }
                else
                {
                    if (listing && !string.IsNullOrWhiteSpace(term) && !value.Name.Contains(term, StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (listing && (favoriteRequested || favoriteFilter) && (value.UserData?.IsFavorite ?? false) != (favorite ?? true))
                        continue;
                    aliases.Overlay(value, user, views);
                    collapsed.Add(value);
                }
            }
            if (listing)
            {
                foreach (var key in new[] { "nameStartsWith", "nameStartsWithOrGreater", "nameLessThan" })
                    if (args.TryGetValue(key, out var boundary) && boundary is string text && !string.IsNullOrEmpty(text))
                        collapsed = collapsed.Where(x => key == "nameStartsWith" ? x.Name.StartsWith(text, StringComparison.OrdinalIgnoreCase) : key == "nameLessThan" ? StringComparer.OrdinalIgnoreCase.Compare(x.Name, text) < 0 : StringComparer.OrdinalIgnoreCase.Compare(x.Name, text) >= 0).ToList();
                // Deduplicate before sorting and paging. Native comparators retain provider metadata.
                if (!args.TryGetValue("sortBy", out var sort) || sort is not Array sa || sa.Length == 0 || sa.Cast<object>().All(x => x.ToString() is "SortName" or "Name"))
                {
                    collapsed = collapsed.OrderBy(x => x.SortName ?? x.Name, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Id).ToList();
                    if (args.TryGetValue("sortOrder", out var order) && order is Array oa && oa.Cast<object>().FirstOrDefault()?.ToString() == "Descending")
                        collapsed.Reverse();
                }
                else if (sort is ItemSortBy[] nativeSort)
                {
                    var order = args.TryGetValue("sortOrder", out var requestedOrder) && requestedOrder is Jellyfin.Database.Implementations.Enums.SortOrder[] orders && orders.Length > 0 ? orders[0] : Jellyfin.Database.Implementations.Enums.SortOrder.Ascending;
                    var byId = collapsed.ToDictionary(x => x.Id);
                    var items = collapsed.Select(x => library.GetItemById(x.Id)).OfType<BaseItem>();
                    collapsed = library.Sort(items, user, nativeSort, order).Where(x => byId.ContainsKey(x.Id)).Select(x => byId[x.Id]).ToList();
                }
            }
            response.Value = new QueryResult<BaseItemDto>(start, collapsed.Count, collapsed.Skip(start).Take(limit ?? int.MaxValue).ToArray());
        }
        else if (response.Value is SearchHintResult hints)
        {
            var seen = new HashSet<string>();
            var list = new List<SearchHint>();
            var nativeHints = hints.SearchHints.ToList();
            bool AllowType(BaseItemKind type) => !args.TryGetValue("includeItemTypes", out var include) || include is not BaseItemKind[] types || types.Length == 0 || types.Contains(type);
            bool Excluded(BaseItemKind type) => args.TryGetValue("excludeItemTypes", out var exclude) && exclude is BaseItemKind[] types && types.Contains(type);
            bool Flag(string key) => !args.TryGetValue(key, out var flag) || flag is not bool b || b;
            foreach (var view in views.Where(v => !string.IsNullOrWhiteSpace(term) && IdentityEngine.SearchScore(v.Identity, term) > 0))
            {
                var person = !AllowType(BaseItemKind.MusicArtist) && AllowType(BaseItemKind.Person);
                var type = person ? BaseItemKind.Person : BaseItemKind.MusicArtist;
                if (AllowType(type) && !Excluded(type) && Flag(person ? "includePeople" : "includeArtists") && !nativeHints.Any(x => aliases.ForId(x.Id, [view]) is not null))
                    nativeHints.Add(new SearchHint { Id = person ? view.Identity.PersonId : view.Identity.ArtistId, Name = view.Identity.PreferredName, Type = type });
            }
            foreach (var value in nativeHints)
            {
                var identity = aliases.ForId(value.Id, views);
                if (identity is not null)
                {
                    if (!seen.Add(identity.Identity.Id))
                        continue;
                    value.Name = identity.Identity.PreferredName;
                }
                list.Add(value);
            }
            response.Value = new SearchHintResult(list.Skip(start).Take(limit ?? int.MaxValue).ToArray(), list.Count);
        }
    }
}
