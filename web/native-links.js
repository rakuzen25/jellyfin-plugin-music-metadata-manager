// Native navigation is read-only and independent of manager/editor actions.
function nativePageUrl(id, locationHref = window.location.href, server = ApiClient.serverId()) {
  if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(String(id || ''))) return null;
  const url = new URL(locationHref);
  url.hash = '/details?' + new URLSearchParams({id, serverId: server});
  return url.href;
}
function nativeLink(id, name = 'item', compact = true, ruleId = null) {
  if (!ruleId && !nativePageUrl(id)) return '';
  const label = 'Open ' + (name || 'item') + ' in Jellyfin (new tab)';
  return '<span class="mmo-native-slot" data-native-id="' + esc(id || '') + '"' +
    (ruleId ? ' data-native-rule="' + esc(ruleId) + '"' : '') +
    ' data-native-label="' + esc(label) + '" data-native-compact="' + compact + '"></span>';
}
function nativeRuleLink(rule, compact = true) {
  return rule && rule.kind !== 'alias' ? nativeLink(null, rule.label || rule.path, compact, rule.id) : '';
}
function issueNativeLink(issue, compact = true) {
  if (issue.itemId) return nativeLink(issue.itemId, issue.name, compact);
  const identity = issue.guidance?.evidence?.identity || doc?.identities?.find(i => i.id === issue.identityId);
  if (identity) return nativeLink(identity.artistId, identity.preferredName, compact);
  if (issue.type === 'unmatched') return nativeRuleLink(issue.context, compact);
  const item = issue.guidance?.evidence?.items?.[0];
  return nativeLink(item?.id, item?.name, compact);
}
function nativePathLink(path, kind, name, compact = false) {
  if (!path || !['track', 'album'].includes(kind)) return '';
  return nativeLink(null, name, compact, 'path')
    .replace(' data-native-rule="path"', ' data-native-path="' + esc(path) + '" data-native-kind="' + kind + '"');
}
function updateWorkspaceNativeLinks() {
  if (ui.screen !== 'workspace') return;
  if (ui.editor?.type === 'identity') {
    q('mmoWorkspaceNative').innerHTML = nativeLink(q('mmoIdentityArtist').value, q('mmoIdentityName').value, false);
    for (const suffix of ['Artist','Person','Artists','Persons']) {
      const select = q('mmoIdentity' + suffix);
      let holder = q('mmoNativeIdentity' + suffix);
      if (!holder) { holder = document.createElement('div'); holder.id = 'mmoNativeIdentity' + suffix; select.closest('label').after(holder); }
      holder.innerHTML = [...select.selectedOptions].filter(o => o.value).map(o => nativeLink(o.value, o.textContent, false)).join('');
    }
  } else if (ui.editor?.type === 'rule') {
    q('mmoWorkspaceNative').innerHTML = nativePathLink(q('mmoPath').value, q('mmoKind').value, ui.editor.name);
  }
}
let nativeLinkScheduled = false, nativeLinkRunning = false, nativeLinkEpoch = 0, nativeLinksActive = true;
async function resolveNativeLinks() {
  if (nativeLinkRunning || !page.isConnected || !nativeLinksActive) return;
  const epoch = nativeLinkEpoch;
  nativeLinkRunning = true;
  try {
    const slots = [...page.querySelectorAll('.mmo-native-slot:not([data-native-resolved])')].slice(0, 20);
    if (!slots.length) return;
    slots.forEach(slot => slot.dataset.nativeResolved = 'pending');
    const ids = [...new Set(slots.map(s => s.dataset.nativeId).filter(Boolean))];
    const rules = [...new Set(slots.map(s => s.dataset.nativeRule).filter(Boolean))];
    const paths = slots.filter(s => s.dataset.nativePath).map(s => ({key: s.dataset.nativeKind + ':' + s.dataset.nativePath, path: s.dataset.nativePath, kind:s.dataset.nativeKind}));
    const data = await api('manager/navigation?' + new URLSearchParams({ids: ids.join(','), rules: rules.join(','), paths: JSON.stringify(paths)}));
    if (!page.isConnected || epoch !== nativeLinkEpoch || !nativeLinksActive) return;
    for (const slot of slots) {
      if (!slot.isConnected) continue;
      const target = slot.dataset.nativePath ? data.paths[slot.dataset.nativeKind + ':' + slot.dataset.nativePath] : slot.dataset.nativeRule ? data.rules[slot.dataset.nativeRule] : data.items[slot.dataset.nativeId];
      const href = target && nativePageUrl(target.id);
      if (href) {
        slot.innerHTML = '<a class="emby-button button-flat mmo-native-link' + (slot.dataset.nativeCompact === 'true' ? ' mmo-native-icon' : '') + '" href="' + esc(href) + '" target="_blank" rel="noopener" aria-label="' + esc(slot.dataset.nativeLabel) + '" title="' + esc(slot.dataset.nativeLabel) + '">' +
          (slot.dataset.nativeCompact === 'true' ? '<span aria-hidden="true">↗</span>' : 'Open in Jellyfin <span aria-hidden="true">↗</span>') + '</a>';
      } else if (slot.dataset.nativeCompact !== 'true') slot.innerHTML = '<span class="secondaryText">Jellyfin page unavailable — record missing or target ambiguous.</span>';
    }
  } catch {
    if (epoch !== nativeLinkEpoch || !nativeLinksActive) return;
    // Navigation availability must never interfere with editors or mutations.
    page.querySelectorAll('.mmo-native-slot[data-native-resolved="pending"]').forEach(slot => {
      if (slot.dataset.nativeCompact !== 'true') slot.textContent = 'Jellyfin link unavailable. Reopen this view to retry.';
    });
  } finally {
    nativeLinkRunning = false;
    if (nativeLinksActive && page.isConnected && page.querySelector('.mmo-native-slot:not([data-native-resolved])')) scheduleNativeLinks();
  }
}
function scheduleNativeLinks() {
  if (nativeLinkScheduled) return;
  nativeLinkScheduled = true;
  queueMicrotask(() => { nativeLinkScheduled = false; resolveNativeLinks(); });
}
const nativeLinkObserver = new MutationObserver(scheduleNativeLinks);
nativeLinkObserver.observe(page, {childList:true, subtree:true});

page.addEventListener('change', e => {
  if (['mmoIdentityArtist','mmoIdentityPerson','mmoIdentityArtists','mmoIdentityPersons','mmoKind'].includes(e.target.id)) updateWorkspaceNativeLinks();
});
page.addEventListener('input', e => { if (e.target.id === 'mmoPath') updateWorkspaceNativeLinks(); });
for (const event of ['pagehide','viewhide','viewbeforehide']) page.addEventListener(event, () => {
  nativeLinksActive = false; nativeLinkEpoch++; nativeLinkObserver.disconnect();
});
page.addEventListener('pageshow', () => {
  nativeLinksActive = true; nativeLinkObserver.observe(page, {childList:true, subtree:true});
  page.querySelectorAll('.mmo-native-slot').forEach(s => { delete s.dataset.nativeResolved; s.replaceChildren(); });
  scheduleNativeLinks();
});

function nativeLinksRouteChanged() {
  if (!/configurationpage\?[^#]*name=musicmetadatamanager(?:&|$)/i.test(window.location.hash)) {
    nativeLinksActive = false; nativeLinkEpoch++; nativeLinkObserver.disconnect();
  }
}
window.addEventListener('hashchange', nativeLinksRouteChanged);
const nativeLinksDetached = new MutationObserver(() => {
  if (!page.isConnected) {
    nativeLinksActive = false; nativeLinkEpoch++; nativeLinkObserver.disconnect(); nativeLinksDetached.disconnect();
    window.removeEventListener('hashchange', nativeLinksRouteChanged);
  }
});
nativeLinksDetached.observe(document.documentElement, {childList:true, subtree:true});
