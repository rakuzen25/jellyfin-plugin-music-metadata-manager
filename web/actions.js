// Commands own their pending state independently of DOM nodes and notices.
const actions = (() => {
  const pending = new Map(), buttons = new Map();
  let trigger = null, current = null, writeTail = Promise.resolve(), scheduled = false;
  function describe(button) {
    const row = button?.closest('.mmo-row');
    const repairCommand = !!button?.matches('#mmoRepairStage, #mmoRepairSkip, [data-issue-choice=skip]');
    const resource = repairCommand ? 'repairQueue' : row?.dataset.changeKey || row?.dataset.issueKey || (ui.screen === 'issue' ? issuePanelState?.issue.key : null) ||
      button?.dataset.id || button?.dataset.managerItem ||
      (ui.screen === 'workspace' ? ui.editor?.key : ui.screen === 'review' ? 'review' : ui.view);
    const command = button?.id || JSON.stringify(Object.fromEntries(Object.entries(button?.dataset || {}).filter(([k]) => k !== 'actionLabel'))) || 'operation';
    const label = button?.dataset.actionLabel || button?.textContent.trim() || 'Operation';
    const navigation = !!button?.matches('[data-view], [data-item-tab], [data-actions-open], [data-menu-command], #mmoWorkspaceBack, #mmoReviewBack, #mmoReviewCancel, #mmoRepairReturn, #mmoIssuePanelBack, #mmoIssueEditorBack, #mmoIssueFullWorkspace, [data-issue-choice=return], [data-issue-choice=choices]') || /^(Cancel|← Back|Resume|Inspect|Edit$|New )/.test(label);
    const write = !navigation && (/^(Save\b|Discard saved|Discard pending|Delete draft|Import as|Acknowledge|Archive report|Reapply|Apply changes)/i.test(label) || /DeleteDraft|deleteDraft/.test(button?.dataset.action || ''));
    const local = !!button?.matches("[data-field-action], [data-image-empty], [data-image-unmanage], [data-source-field]");
    const issueEdit = !!button?.matches('[data-issue-choice=link], [data-issue-choice=use-identity], [data-issue-choice=use-records], [data-issue-choice=metadata], [data-issue-choice=binding], [data-issue-choice=split], [data-issue-choice=rule], [data-issue-policy], [data-issue-binding]');
    const editing = repairCommand || issueEdit || !navigation && !local && /Preview|Review|Save|Cache|Fetch comparison|Keep current|Keep empty|Stop managing|Restore original|Stage and next/i.test(label);
    return {button, command, resource, key: command + ':' + resource,
      label, write, editing, navigation, item: row?.querySelector('strong')?.textContent || ui.editor?.name || (ui.screen === 'issue' ? issuePanelState?.issue.name : '') || '',
      context: {screen: ui.screen, view: ui.view, item: ui.editor?.key || null},
      anchor: row?.querySelector('.mmo-row-main') || button?.closest('.mmo-editor-actions, .mmo-actions') || button?.parentElement,
      itemId: ui.editor?.itemId,
      origin: ui.editor ? {key: ui.editor.key, view: ui.view} : {view: ui.view, issueKey: ui.screen === 'issue' ? issuePanelState?.issue.key : null}};
  }
  function conflict(meta) {
    return [...pending.values()].some(p => !p.navigation && !meta.navigation &&
      (p.key === meta.key || (p.write && meta.write) ||
       (p.resource === meta.resource && p.editing && meta.editing)));
  }
  function capture(event) {
    const button = event.type === 'submit' ? event.submitter || event.target.querySelector('[type=submit]') : event.target.closest('button');
    trigger = button;
    if (button && !button.matches('[data-menu-command]') && conflict(describe(button))) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
    // Native events may checkpoint microtasks between capture and target listeners.
    // Keep the initiating control through the entire dispatch task.
    setTimeout(() => { if (trigger === button) trigger = null; }, 0);
  }
  page.addEventListener('click', capture, true);
  page.addEventListener('submit', capture, true);
  function acquire() {
    const meta = describe(trigger);
    if (!trigger) { meta.key = 'background:' + crypto.randomUUID(); meta.editing = false; }
    if (conflict(meta)) return null;
    pending.set(meta.key, meta); current = meta; sync(); return meta;
  }
  function release(meta) {
    pending.delete(meta.key); if (current === meta) current = null;
    sync();
    if (typeof setEditorWritable === 'function' && ui.editor?.type === 'metadata') setEditorWritable();
    if (typeof renderBulkSelection === 'function' && doc) renderBulkSelection();
    if (typeof renderIssues === 'function' && ui.issueLoaded && ui.view === 'issues') renderIssues();
    sync();
  }
  function buttonLabel(button, text) {
    const node = [...button.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()) || button.querySelector('.buttonText, .button-text');
    if (node && node.textContent !== text) node.textContent = text;
  }
  function sync() {
    for (const button of page.querySelectorAll('button')) {
      if (button.closest('.mmo-feedback, #mmoMessage')) continue;
      const meta = describe(button), busy = conflict(meta);
      let state = buttons.get(button);
      if (busy) {
        if (!state) { state = {disabled: button.disabled, label: button.textContent}; buttons.set(button, state); }
        button.setAttribute('aria-disabled', 'true'); button.setAttribute('aria-busy', 'true');
        if (!button.disabled) button.disabled = true;
        const own = pending.get(meta.key);
        if (own) {
          const text = own.write ? (/Save/.test(own.label) ? 'Saving draft…' : /Apply changes/.test(own.label) ? 'Applying changes…' : 'Working…') : /Preview|Review/.test(own.label) ? 'Preparing review…' : /Cache|Keep current/.test(own.label) ? 'Caching artwork…' : 'Loading…';
          buttonLabel(button, text);
          button.dataset.actionLabel = own.label;
        }
      } else if (state) {
        button.disabled = state.disabled;
        button.removeAttribute('aria-disabled'); button.removeAttribute('aria-busy');
        if (button.dataset.actionLabel) { buttonLabel(button, state.label); delete button.dataset.actionLabel; }
        buttons.delete(button);
      }
    }
    for (const button of buttons.keys()) if (!button.isConnected) buttons.delete(button);
    if (q('mmoReviewCancel')) buttonLabel(q('mmoReviewCancel'), isPending('mmoActivate') ? 'Leave review' : 'Cancel review');
  }
  const observer = new MutationObserver(records => {
    if (records.every(r => r.target.closest?.('.mmo-feedback, #mmoMessage, #mmoAnnouncements'))) return;
    for (const r of records) if (r.attributeName === 'disabled' && buttons.has(r.target) && !r.target.disabled) buttons.get(r.target).disabled = false;
    if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; sync(); }); }
  });
  observer.observe(page, {subtree:true, childList:true, attributes:true, attributeFilter:['disabled']});
  function isPending(command) { return [...pending.values()].some(p => p.command === command); }
  function setDisabled(button, disabled) {
    const state = buttons.get(button);
    if (state) state.disabled = !!disabled;
    button.disabled = !!disabled || conflict(describe(button));
  }
  async function serializeWrite(work) {
    const result = writeTail.then(work); writeTail = result.catch(() => {}); return result;
  }
  return {acquire, release, sync, setDisabled, isPending, describe, serializeWrite, current: () => current};
})();
