// Each operation owns feedback; presentation may move without re-announcing it.
const notifications = (() => {
  let operation = 0, active = true, generation = 0, navigation = 0, frame = null;
  const records = new Map(), notices = new Map();
  const context = () => ({screen:ui.screen, view:ui.view, item:ui.editor?.key || null});
  const sameContext = r => JSON.stringify(r.context) === JSON.stringify(context());
  function valid(id) {
    const r = records.get(id);
    return active && page.isConnected && !!r && r.generation === generation && !r.cancelled && r.navigation === navigation && sameContext(r);
  }
  function remove(id) {
    const n = notices.get(id);
    if (!n) return;
    clearTimeout(n.timer);
    const host = n.node.parentElement, anchor = records.get(id)?.command?.anchor;
    n.node.remove();
    for (const slot of [host,anchor]) if(slot?.classList.contains("mmo-feedback-slot") && !slot.children.length) slot.remove();
    notices.delete(id);
  }
  function clear(all = false) {
    navigation++;
    for (const [id,n] of notices) {
      const r = records.get(id);
      if (all || n.kind !== 'loading' || !r.command?.write || r.finished) remove(id);
    }
    for (const r of records.values()) if (!r.command?.write) r.cancelled = true;
    q("mmoAnnouncements").textContent = "";
    q("mmoAlertAnnouncements").textContent = "";
    render();
    schedule();
  }
  function pause(n) {
    if (n.timer) { clearTimeout(n.timer); n.timer = null; n.remaining -= performance.now() - n.started; }
  }
  function expire(n) {
    if (n.kind !== 'success' || n.timer || n.hover || n.node.contains(document.activeElement) || document.hidden) return;
    n.started = performance.now();
    n.timer = setTimeout(() => { if (notices.get(n.id) === n) { remove(n.id); render(); } }, Math.max(0,n.remaining));
  }
  function dismiss(id) {
    const n = notices.get(id), r = records.get(id);
    if (r) r.dismissed = n?.kind || true;
    const button = r?.command?.button;
    remove(id); render();
    const nearby = sameContext(r) ? button?.closest('.mmo-actions, .mmo-editor-actions')?.querySelector('button:not(:disabled):not([data-notice-dismiss]):not([data-notice-return])') : null;
    const fallback = ui.screen === 'review' ? q('mmoReviewBack') : ui.screen === 'workspace' ? q('mmoWorkspaceBack') : ui.screen === 'issue' ? q('mmoIssuePanelBack') : q('mmoNavigation').querySelector('[aria-current=page]');
    const target = sameContext(r) && button?.isConnected && !button.disabled && !button.closest('[hidden]') ? button : nearby || fallback;
    target?.focus({preventScroll:true});
  }
  function createNode(id, text, kind, r) {
    const node = document.createElement('div'); node.className = 'mmo-feedback'; node.dataset.kind = kind; node.dataset.operation = id;
    const label = r.command?.item ? r.command.item + ' · ' : '';
    node.innerHTML = '<span class="mmo-feedback-text">' + esc(label + text) + '</span>' +
      '<div class="mmo-feedback-actions">' +
      (r.command?.origin ? nativeButton('Return', 'data-notice-return') : '') +
      nativeButton('Dismiss', 'data-notice-dismiss aria-label="Dismiss notification"') + '</div>';
    node.querySelector('[data-notice-dismiss]').onclick = () => dismiss(id);
    node.querySelector('[data-notice-return]')?.addEventListener('click', () => {
      const origin = r.command.origin;
      perform(async () => {
        if (origin.issueKey && issueItems.some(i => i.key === origin.issueKey)) await openIssuePanel(issueItems.find(i => i.key === origin.issueKey));
        else if (origin.key && ui.locals.has(origin.key)) await resumeEntry(ui.locals.get(origin.key));
        else if (origin.key?.startsWith('metadata:') && r.command.itemId) await managerOpen(r.command.itemId);
        else await showDestination(origin.view, true, true);
      });
    });
    return node;
  }
  function feedbackAnchor(button) {
    const group = button.closest('.mmo-row')?.querySelector('.mmo-row-main') || button.closest('.mmo-editor-actions, .mmo-actions');
    if (group) return group;
    const slot = document.createElement('div'); slot.className = 'mmo-feedback-slot';
    button.after(slot); return slot;
  }
  function show(text, kind = 'success', id = operation) {
    const r = records.get(id);
    if (!active || !page.isConnected || !r || r.generation !== generation || (r.dismissed && (r.dismissed !== 'loading' || kind === 'loading')) || (!r.command?.write && !(r.command?.navigation && id === operation) && !valid(id))) return;
    if (r.dismissed === 'loading' && kind !== 'loading') r.dismissed = false;
    remove(id);
    if (!text) { render(); return; }
    if (sameContext(r) && r.command?.button?.isConnected) r.command.anchor = feedbackAnchor(r.command.button);
    const node = createNode(id,text,kind,r), n = {id, text, kind, node, remaining:5000, timer:null, hover:false};
    node.onmouseenter = () => {n.hover=true;pause(n);};
    node.onmouseleave = () => {n.hover=false;expire(n);schedule();};
    node.onfocusin = () => pause(n); node.onfocusout = () => queueMicrotask(() => {expire(n);schedule();});
    notices.set(id,n);
    const announcer = q(kind === 'error' || kind === 'warning' ? 'mmoAlertAnnouncements' : 'mmoAnnouncements');
    announcer.textContent = (r.command?.item ? r.command.item + ': ' : '') + text;
    render();
  }
  function render() {
    frame = null;
    if (!active) return;
    const fallback = [];
    for (const n of notices.values()) {
      const r = records.get(n.id), command = r.command;
      let anchor = command?.anchor;
      if (command && !anchor?.isConnected && sameContext(r)) {
        const button = command.button?.id ? q(command.button.id) : [...page.querySelectorAll('button')].find(b => actions.describe(b).key === command.key);
        if (button) { command.button = button; anchor = feedbackAnchor(button); command.anchor = anchor; }
      }
      const local = sameContext(r) && anchor?.isConnected && !anchor.closest('[hidden]');
      const anchorBounds = local ? anchor.getBoundingClientRect() : null;
      const floating = n.node.classList.contains('mmo-feedback-floating');
      const interacting = n.hover || n.node.contains(document.activeElement);
      const room = local && anchorBounds.top >= 0 && anchorBounds.top < innerHeight &&
        (getComputedStyle(anchor).position === 'sticky' || anchorBounds.bottom + n.node.getBoundingClientRect().height <= innerHeight);
      if (local && (!floating || (room && !interacting))) {
        n.node.hidden = false;
        if (n.node.parentNode !== anchor) anchor.append(n.node);
        n.node.classList.remove('mmo-feedback-floating');
        n.node.querySelector('[data-notice-return]')?.setAttribute('hidden','');
        const rect = n.node.getBoundingClientRect();
        if (rect.top >= 0 && rect.bottom <= innerHeight) {
          expire(n); continue;
        }
      }
      n.node.classList.add('mmo-feedback-floating');
      n.node.querySelector('[data-notice-return]')?.removeAttribute('hidden');
      fallback.push(n);
    }
    const container = q('mmoMessage'), body = q('mmoNoticeList');
    const floatingNodes = fallback.map(n => n.node);
    for (const child of [...body.children]) if (!floatingNodes.includes(child)) child.remove();
    floatingNodes.forEach((node,index) => { if(body.children[index] !== node) body.insertBefore(node,body.children[index] || null); });
    container.hidden = !fallback.length;
    if (fallback.length) {
      const surface = [page,document.body,document.documentElement].map(el => getComputedStyle(el).backgroundColor).find(c => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent');
      if (surface) container.style.backgroundColor = surface;
    }
    q('mmoNoticeMore').hidden = fallback.length <= 1;
    q('mmoNoticeMore').textContent = fallback.length + ' operations';
    fallback.forEach((n,index) => {
      n.node.hidden = index > 0 && container.dataset.expanded !== 'true';
      const bounds = n.node.getBoundingClientRect(), dock = container.getBoundingClientRect();
      if (n.node.hidden || bounds.top >= dock.bottom || bounds.bottom <= dock.top) pause(n); else expire(n);
    });
    const footer = [...page.querySelectorAll('.mmo-editor-actions')].find(el => !el.closest('[hidden]'));
    const rect = footer?.getBoundingClientRect();
    container.style.bottom = rect && rect.bottom >= innerHeight - 2 && rect.top < innerHeight ? (innerHeight-rect.top+8)+'px' : '';
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(render); }
  function scope(id = operation) { return (text,kind) => show(text,kind,id); }
  function begin(command) {
    const id = ++operation;
    for (const [old,r] of records) if (command?.key && r.command?.key === command.key) { remove(old); r.cancelled = true; }
    records.set(id,{id,command,context:context(),generation,navigation,cancelled:false,dismissed:false});
    return id;
  }
  function finish(id) { const r=records.get(id); if(r)r.finished=true; if (notices.get(id)?.kind === 'loading') remove(id); render(); }
  function leave() { clear(true); active=false; generation++; if(frame) cancelAnimationFrame(frame);frame=null; }
  function enter() { active=true;render(); }
  q('mmoNoticeMore').onclick = () => {const el=q('mmoMessage');el.dataset.expanded=el.dataset.expanded==='true'?'false':'true';q('mmoNoticeMore').setAttribute('aria-expanded',el.dataset.expanded);render();};
  window.addEventListener('scroll',schedule,true); window.addEventListener('resize',schedule);
  const visibilityChanged = () => { for(const n of notices.values()) document.hidden ? pause(n) : expire(n); };
  document.addEventListener('visibilitychange',visibilityChanged);
  const routeChanged=()=>location.hash.toLowerCase().includes('configurationpage?name=musicmetadatamanager')?enter():leave();
  window.addEventListener('hashchange',routeChanged);window.addEventListener('popstate',routeChanged);
  for(const event of ['pagehide','viewhide','viewbeforehide'])page.addEventListener(event,leave);
  for(const event of ['pageshow','viewshow'])page.addEventListener(event,enter);
  const detached=new MutationObserver(()=>{if(!page.isConnected){leave();detached.disconnect();document.removeEventListener('visibilitychange',visibilityChanged);window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);window.removeEventListener('hashchange',routeChanged);window.removeEventListener('popstate',routeChanged);}});
  detached.observe(document.body,{childList:true,subtree:true});
  return {begin,scope,finish,clear,show,valid};
})();
function message(text,kind='success'){notifications.show(text,kind);}
