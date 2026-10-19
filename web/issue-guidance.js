// Guidance is visit-local. Backend facts drive choices; choices never apply edits.
let issuePanelState = null, issueEditor = null, issueVerification = null;
let issueCheckTimer = null, issueCheckSerial = 0;
const issueTypeNames = {credit:'Unresolved credit',binding:'Broken binding',repair:'Repair candidate',orphan:'Verified orphan',blocked:'Blocked record',report:'Application report',unmatched:'Unmatched correction',recreated:'Recreated record',audit:'Audit failure'};
const issueNameKey = value => String(value || '').normalize('NFC').toUpperCase();
function issueChoice(label, choice, description = '') {
  return '<div class="mmo-issue-choice">' + nativeButton(label, 'data-issue-choice="' + choice + '"') + (description ? '<p class="secondaryText">' + esc(description) + '</p>' : '') + '</div>';
}
function issueExample(issue) {
  const e = issue.guidance.evidence || {}, uses = e.items || e.music || [];
  const item = uses[0];
  let html = item ? '<section class="mmo-issue-example"><strong>' + esc(item.name) + '</strong>' + nativeLink(item.id, item.name) + '<p class="secondaryText mmo-value">' + esc(item.path) + '</p>' + (e.credit ? '<p>' + esc(e.role === 'albumArtists' ? 'Album artist' : 'Performer') + ': ' + esc(e.credit) + '</p>' : '') + '</section>' : '';
  if (issue.type === 'repair') html += '<p>Stored name: <strong>' + esc(issue.name) + '</strong><br>Metadata-folder name: <strong>' + esc((e.path || '').split('/').filter(Boolean).at(-1)) + '</strong></p><p class="secondaryText">A different name can be legitimate. Compare credits and source evidence before changing it.</p>';
  if (issue.type === 'binding') html += '<p>Missing: <strong>' + esc(e.missing.join(', ')) + '</strong></p>';
  if (uses.length > 1) html += '<details><summary>All affected items (' + uses.length + ')</summary>' + uses.map(u => '<p>' + esc(u.name) + nativeLink(u.id, u.name) + '<br><span class="secondaryText mmo-value">' + esc(u.path) + '</span></p>').join('') + '</details>';
  return html;
}
function dependencyEvidence(e) {
  if (!e || !Array.isArray(e.music)) return '';
  const values = [['Music uses',e.music.length],['Non-music uses',e.nonMusic.length],['Descendants',e.descendants],['Linked references',e.linkedReferences],['User-data entries',e.userData],['Identity bindings',e.bindings.length],['Managed policies',e.policies.length]];
  return '<dl class="mmo-issue-dependencies">' + values.filter(([,n]) => n).map(([name,n]) => '<dt>' + name + '</dt><dd>' + n + '</dd>').join('') + '</dl>' + (e.canDelete ? '<p>No blocking dependencies found.</p>' : '<p class="secondaryText">Keep legitimate dependencies. User data is not removed by this plugin.</p>');
}
async function openIssuePanel(issue, guided = false) {
  if (!issue) throw Error('This finding is no longer present. Refresh Issues.');
  captureEditor(); invalidateReview();
  if (ui.screen === 'list') {
    ui.scroll.set('issues', window.scrollY);
    ui.listFocus = {view:'issues', element:document.activeElement, selector:'[data-issue-open="'+CSS.escape(issue.key)+'"]'};
  }
  ui.request++;
  resetIssueEditor();
  ui.editor = null; ui.stack = []; ui.view = 'issues';
  issuePanelState = {issue, guided, request:ui.request};
  displayScreen('issue');
  q('mmoIssuePanelTitle').textContent = issue.name;
  const e = issue.guidance.evidence || {};
  let choices = '';
  const references = [...(e.items || []), ...(e.music || []), ...(e.nonMusic || []), ...(e.candidates || [])];
  const evidenceLinks = references.length ? '<details><summary>Related Jellyfin pages</summary>' + [...new Map(references.map(x => [x.id,x])).values()].map(x => '<p>' + esc(x.name || x.id) + nativeLink(x.id, x.name || 'related item') + '</p>').join('') + '</details>' : ''; 
  switch (issue.type) {
    case 'credit':
      if (issue.identityId) choices += issueChoice('Repair existing identity binding','binding');
      choices += issueChoice('Link existing artist','link','Keep the original credited name; choose the identity or native records explicitly.');
      choices += issueChoice('Split combined credit','split','Enter each intended performer yourself. No automatic splitting.');
      choices += issueChoice('Investigate missing artist','missing'); break;
    case 'binding': choices += issueChoice('Select replacement representatives','binding'); break;
    case 'repair':
      if (issue.canRepair) choices += issueChoice('Review metadata and sources','metadata') + issueChoice('Link an artist identity','link');
      choices += issueChoice('Inspect native record','inspect'); break;
    case 'orphan': choices += issueChoice('Review deletion','cleanup','Review internal metadata/artwork removal and recovery material. Audio stays intact.') + issueChoice('Inspect record','inspect'); break;
    case 'blocked':
      choices += dependencyEvidence(e);
      choices += issueChoice('Inspect record and dependencies','inspect');
      for (const id of e.bindings || []) choices += nativeButton('Inspect identity binding', 'data-issue-binding="' + esc(id) + '"');
      for (const id of e.policies || []) choices += nativeButton('Inspect managed policy', 'data-issue-policy="' + esc(id) + '"');
      break;
    case 'unmatched': choices += issueChoice('Update target and scope','rule') + issueChoice('Review disable','disable') + issueChoice('Review delete','delete') + '<p class="secondaryText">If the media is temporarily unavailable, leave this correction active.</p>'; break;
    case 'recreated':
      choices += dependencyEvidence(e) + issueChoice('Inspect record and current uses','inspect');
      if (e.canDelete) choices += issueChoice('Review orphan deletion again','cleanup');
      else if (e.canEdit && e.music?.length) choices += issueChoice('Review artist metadata','metadata');
      break;
    case 'report':
      choices += '<details><summary>Original error</summary><p class="mmo-value">' + esc(e.message || issue.reason) + '</p></details>';
      if (issue.itemId) choices += issueChoice('Inspect affected item','inspect');
      if (['cleanup-review-stale','cleanup-failure'].includes(issue.causeCode)) choices += issueChoice('Check current cleanup eligibility','recheck');
      else if (issue.causeCode === 'application-failure' && issue.itemId) choices += issueChoice('Reapply active corrections','reapply','Explicit retry of active corrections across the library; this does not retry cleanup.');
      choices += issueChoice('Archive report','archive','Archive this occurrence only. No correction is retried.'); break;
    case 'audit':
      choices += '<details><summary>Inspection error</summary><p class="mmo-value">' + esc(issue.reason) + '</p></details>' + (issue.causeCode==='inspection-access-denied'?'<p>Inspect filesystem permissions and library access, then check again.</p>':issue.causeCode==='inspection-io-failure'?'<p>Check the affected path and available storage, then check again.</p>':'');
      if (issue.itemId) choices += issueChoice('Inspect affected item','inspect');
      choices += issueChoice('Check again','recheck'); break;
  }
  q('mmoIssuePanelBody').innerHTML = '<p class="secondaryText">' + esc(issueTypeNames[issue.type]) + '</p><p>' + esc(issue.guidance.summary) + '</p>' + issueNativeLink(issue, false) + issueExample(issue) + evidenceLinks + '<div id="mmoIssueChoices">' + choices + '</div><div id="mmoIssueDecision" hidden></div><details><summary>Evidence and technical details</summary><p class="mmo-value">' + esc(issue.guidance.path || '') + '</p><pre>' + esc(JSON.stringify({cause:issue.causeCode,reason:issue.reason,evidence:e},null,2)) + '</pre></details>' + (guided ? '<div class="mmo-actions">' + nativeButton('Skip this repair','data-issue-choice="skip"') + nativeButton('Return to Issues','data-issue-choice="return"') + '</div>' : '');
  normalizeControls(q('mmoIssuePanel'));
  q('mmoIssuePanelTitle').focus({preventScroll:true}); window.scrollTo(0,0);
}
function resetIssueEditor() {
  for (const el of page.querySelectorAll('[data-issue-hidden]')) {el.hidden = false; delete el.dataset.issueHidden;}
  q('mmoIssueEditorContext').hidden = true;
  issueEditor = null;
}
function focusIssueEditor(issue, guided, choice, full = false) {
  issueEditor = {issue,guided,choice,full,key:ui.editor.key};
  ui.editor.issueRepair = issueEditor;
  q('mmoIssueEditorContext').hidden = false;
  q('mmoIssueEditorSummary').textContent = issue.name + ' · ' + ({split:'Enter the intended names, then preview.',binding:'Select missing representatives, then preview.',link:'Confirm aliases and representatives, then preview.',metadata:'Compare and approve the intended artist values.',rule:'Update the target or scope, then preview.',inspect:'Inspect the evidence; no changes are required.'}[choice] || 'Review the intended repair.');
  const hide = el => {if(el && !el.hidden){el.hidden=true;el.dataset.issueHidden='true';}};
  applyIssueFieldFocus();
  if (!full && ui.editor.type === 'identity') {
    for (const id of ['mmoIdentityArtists','mmoIdentityPersons','mmoIdentityMbid']) hide(q(id).closest('label'));
    for (const id of ['mmoLocalSuggestions','mmoBrainzSuggestions','mmoIdentitySuggestions']) hide(q(id));
  }
  if (!full && ui.editor.type === 'rule' && choice === 'rule') {
    hide(q('mmoFieldsArea')); hide(q('mmoAliasArea').querySelector('textarea')?.closest('label'));
  }
  q('mmoIssueFullWorkspace').hidden = !page.querySelector('[data-issue-hidden]');
  if(ui.editor.dirty) captureEditor();
  if (guided) {
    q('mmoRepairControls').hidden = false;
    q('mmoRepairContext').textContent = 'Repair ' + (repairQueue.index+1) + ' of ' + repairQueue.tasks.length + ': ' + issue.name;
    q('mmoRepairStage').disabled = ui.editor.type === 'metadata' && q('mmoManagerPreview').disabled;
  }
}
function applyIssueFieldFocus() {
  if(!issueEditor || !ui.editor || issueEditor.key!==ui.editor.key || issueEditor.full || ui.editor.type!=='metadata' || issueEditor.choice!=='metadata')return;
  for(const el of q('mmoManagerFields').querySelectorAll('[data-field],.mmo-advanced')){
    if(el.matches('.mmo-advanced') || !['title','sortName','overview'].includes(el.dataset.field)) {el.hidden=true;el.dataset.issueHidden='true';}
  }
}
async function editIssueTarget(choice, identity) {
  const state = issuePanelState, {issue,guided} = state;
  if (choice === 'binding') {
    identity = doc.identityDrafts.concat(doc.identities).find(i=>i.id===issue.identityId);
    if (!identity) throw Error('Identity no longer exists. Refresh Issues.');
  }
  if (identity) {
    await editIdentity(identity);
    if (issuePanelState !== state || ui.screen !== 'workspace') return;
    if (choice === 'link' && !doc.identities.concat(doc.identityDrafts).some(i=>i.id===identity.id)) markDirty();
    if (choice === 'link' && issue.type === 'credit') {
      const aliases=q('mmoIdentityAliases').value.split('\n').filter(Boolean);
      if (![q('mmoIdentityName').value,...aliases].some(n=>issueNameKey(n)===issueNameKey(issue.name))) {
        q('mmoIdentityAliases').value=[...aliases,issue.name].join('\n'); markDirty();
      }
    }
  } else if (choice === 'split') {
    const e=issue.guidance.evidence;
    const mapping=doc.drafts.concat(doc.active).find(r=>r.kind==='alias' && r.credit===issue.name && r.libraries.includes(e.library) && (r.role===e.role||r.role==='both'));
    edit(mapping || {id:crypto.randomUUID().replaceAll('-',''),label:'Repair credit: '+issue.name,kind:'alias',credit:issue.name,names:[],role:e.role,libraries:[e.library]});
    if(!mapping) markDirty();
  } else if (choice === 'rule') edit(issue.context);
  else await managerOpen(issue.itemId);
  if (issuePanelState !== state || ui.screen !== 'workspace') return;
  focusIssueEditor(issue,guided,choice);
}
async function showArtistChoices() {
  const state = issuePanelState, request = ui.request;
  const records = await api('identities/records');
  if (issuePanelState!==state || request!==ui.request || ui.screen!=='issue') return;
  const {issue}=state,e=issue.guidance.evidence || {};
  const scope=e.library || e.music?.[0]?.library;
  const identities=doc.identityDrafts.concat(doc.identities).filter((i,index,all)=>all.findIndex(x=>x.id===i.id)===index && (!scope || i.libraries.includes(scope)));
  const candidates=e.candidates || [];
  const rank=r=>candidates.find(c=>c.id===r.id)?.match || (issueNameKey(r.name)===issueNameKey(issue.name)?'name':null);
  const order=match=>({identity:0,name:1,'metadata-folder':2}[match]??3);
  const options=rows=>'<option value="">Choose a record</option>'+[...rows].sort((a,b)=>order(rank(a))-order(rank(b))||a.name.localeCompare(b.name)).map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name)+' · '+esc(r.id.slice(0,8))+(rank(r)?' — '+esc({identity:'existing identity member',name:'exact name match','metadata-folder':'metadata-folder match'}[rank(r)]):'')+'</option>').join('');
  const matching=i=>issueNameKey(i.preferredName)===issueNameKey(issue.name)||i.aliases.some(a=>issueNameKey(a)===issueNameKey(issue.name));
  q('mmoIssueChoices').hidden=true;
  q('mmoIssueDecision').hidden=false;
  q('mmoIssueDecision').innerHTML='<h3>Choose the artist explicitly</h3>'+ (identities.length?'<label class="selectContainer">Existing identity<select is="emby-select" id="mmoIssueIdentity"><option value="">Choose an identity</option>'+identities.sort((a,b)=>Number(matching(b))-Number(matching(a))||a.preferredName.localeCompare(b.preferredName)).map(i=>'<option value="'+esc(i.id)+'">'+esc(i.preferredName)+(matching(i)?' — recognized name':'')+'</option>').join('')+'</select></label>'+nativeButton('Use chosen identity','data-issue-choice="use-identity" disabled'):'')+'<details><summary>Create an identity using existing records</summary><p class="secondaryText">Both endpoint-compatible representatives are required. This creates no native artist records.</p><label>Preferred page name<input is="emby-input" id="mmoIssuePreferredName" value="'+esc(issue.name)+'" /></label><label>MusicArtist representative<select is="emby-select" id="mmoIssueArtist">'+options(records.artists)+'</select></label><label>Person representative<select is="emby-select" id="mmoIssuePerson">'+options(records.persons)+'</select></label>'+nativeButton('Use chosen records','data-issue-choice="use-records" disabled')+'</details>'+nativeButton('Back to choices','data-issue-choice="choices"');
  q('mmoIssueDecision').insertAdjacentHTML('beforeend', '<div id="mmoIssueCandidateLinks" class="mmo-actions"></div>');
  normalizeControls(q('mmoIssueDecision'));
}
q('mmoIssuePanelBody').onchange=(event)=>{
  const identity=page.querySelector('[data-issue-choice="use-identity"]'), records=page.querySelector('[data-issue-choice="use-records"]');
  if(q('mmoIssueCandidateLinks') && ['mmoIssueIdentity','mmoIssueArtist','mmoIssuePerson'].includes(event.target.id)) {
    const chosen = doc.identities.find(i => i.id === q('mmoIssueIdentity')?.value);
    q('mmoIssueCandidateLinks').innerHTML = nativeLink(chosen?.artistId, chosen?.preferredName, false) + nativeLink(q('mmoIssueArtist')?.value, 'selected MusicArtist', false) + nativeLink(q('mmoIssuePerson')?.value, 'selected Person', false);
  }
  if(identity) actions.setDisabled(identity,!q('mmoIssueIdentity').value);
  if(records) actions.setDisabled(records,!q('mmoIssueArtist').value||!q('mmoIssuePerson').value||!q('mmoIssuePreferredName').value.trim());
};
q('mmoIssuePanelBody').oninput=q('mmoIssuePanelBody').onchange;
q('mmoIssuePanelBack').onclick=()=>perform(()=>showDestination('issues',true,true));
q('mmoIssueEditorBack').onclick=()=>perform(()=>openIssuePanel(issueEditor.issue,issueEditor.guided));
q('mmoIssueFullWorkspace').onclick=()=>{
  if(issueEditor)issueEditor.full=true;
  for(const el of page.querySelectorAll('[data-issue-hidden]')){el.hidden=false;delete el.dataset.issueHidden;}
  q('mmoIssueFullWorkspace').hidden=true;
};
q('mmoIssuePanelBody').onclick=e=>{
  const b=e.target.closest('button'); if(!b) return;
  perform(async operation=>{
    const state=issuePanelState, {issue}=state, choice=b.dataset.issueChoice;
    if(b.dataset.issueBinding){const i=doc.identityDrafts.concat(doc.identities).find(x=>x.id===b.dataset.issueBinding);if(!i)throw Error('Binding no longer exists. Refresh Issues.');await editIssueTarget('link',i);return;}
    if(b.dataset.issuePolicy){const id=b.dataset.issuePolicy,p=doc.policyDrafts.concat(doc.policies).find(x=>x.id===id),r=doc.drafts.concat(doc.active).find(x=>x.id===id);if(p)await managerOpen(p.itemId||doc.identities.find(i=>i.id===p.identityId)?.artistId,p);else if(r)edit(r);else throw Error('Policy no longer exists. Refresh Issues.');if(issuePanelState===state&&ui.screen==='workspace')focusIssueEditor(issue,state.guided,'inspect');return;}
    if(!choice)return;
    if(choice==='link')return showArtistChoices();
    if(choice==='choices')return openIssuePanel(issue,state.guided);
    if(choice==='use-identity'){
      const id=q('mmoIssueIdentity').value,identity=doc.identityDrafts.concat(doc.identities).find(i=>i.id===id);if(!identity)throw Error('Choose an identity first.');return editIssueTarget('link',identity);
    }
    if(choice==='use-records'){
      const artistId=q('mmoIssueArtist').value,personId=q('mmoIssuePerson').value,name=q('mmoIssuePreferredName').value.trim(),ev=issue.guidance.evidence;
      if(!artistId||!personId||!name)throw Error('Choose both representatives and a page name.');
      return editIssueTarget('link',{id:crypto.randomUUID().replaceAll('-',''),preferredName:name,aliases:issueNameKey(name)===issueNameKey(issue.name)?[]:[issue.name],libraries:ev.library?[ev.library]:[...new Set((ev.music||[]).map(u=>u.library))],artistId,personId,artistIds:[],personIds:[]});
    }
    if(['metadata','inspect','binding','split','rule'].includes(choice))return editIssueTarget(choice);
    if(choice==='cleanup')return preview({cleanupIds:[issue.itemId]},null,{action:'cleanup',eligible:[issue],skipped:[]});
    if(choice==='disable'||choice==='delete')return preview({[choice==='disable'?'disableIds':'deleteIds']:[issue.context.id]},null,{action:'repair',eligible:[issue],skipped:[]});
    if(choice==='archive'){
      await api('manager/errors/acknowledge','POST',{ids:[issue.context.id]});issueSelection.delete(issue.key);await managerIssues();if(notifications.valid(operation))await showDestination('issues');notifications.scope(operation)('Report archived. No corrections were retried.');return;
    }
    if(choice==='reapply'){
      await api('apply','POST',{});beginIssueVerification({action:'repair',eligible:[issue],skipped:[]},{});notifications.scope(operation)('Active corrections queued. The original report remains until explicitly archived.');return;
    }
    if(choice==='recheck'){await managerIssues();if(issuePanelState===state && ui.screen==='issue'){const current=issueItems.find(i=>i.key===issue.key);if(current)await openIssuePanel(current,state.guided);else{beginIssueVerification({action:'check',eligible:[issue],skipped:[]},{});await showDestination('issues');}}return;}
    if(choice==='missing'){
      const examples=issue.guidance.evidence.items||[],id=examples[0]?.id;
      q('mmoIssueDecision').hidden=false;q('mmoIssueDecision').innerHTML='<h3>Find or discover the native artist first</h3><p>Inspect an affected release’s credits and provider settings. Use Jellyfin’s metadata controls to identify the correct artist or refresh discovery, then check again.</p>'+ nativeLink(id, examples[0]?.name, false)+'<p class="secondaryText">No record is created and no refresh runs automatically. Identity linking needs both MusicArtist and Person representatives.</p>'+nativeButton('Check again','data-issue-choice="recheck"');return;
    }
    if(choice==='skip'){repairQueue.staged.delete(repairQueue.tasks[repairQueue.index].key);repairQueue.index++;return openRepairTask();}
    if(choice==='return')return showDestination('issues');
  });
};
function stopIssueVerification(){clearTimeout(issueCheckTimer);issueCheckTimer=null;issueCheckSerial++;}
function beginIssueVerification(context,result){
  stopIssueVerification();
  issueVerification={context,result,started:Date.now(),rows:context.eligible.map(issue=>({issue,state:'Applied · checking'}))};
  renderIssueResults();
  if(ui.view==='issues'&&['list','issue'].includes(ui.screen))void checkIssueResolution();
}
function renderIssueResults(){
  const node=q('mmoIssueResults');node.hidden=!issueVerification;if(!issueVerification)return;
  const focused=node.contains(document.activeElement) && document.activeElement.matches('[data-issue-result-check]');
  const expanded=node.querySelector('details')?.open;
  const rows=issueVerification.rows, resolved=rows.filter(r=>r.state==='Resolved').length,remaining=rows.filter(r=>r.state==='Still needs attention').length;
  const checking=rows.filter(r=>r.state==='Applied · checking').length,unverified=rows.length-resolved-remaining-checking;
  const entries=rows.map(r=>'<p><strong>'+esc(r.issue.name)+'</strong>'+issueNativeLink(r.issue)+' — '+esc(r.state)+(r.reason?'<br><span class="secondaryText">'+esc(r.reason)+'</span>':'')+'</p>'+(r.recoveryPath?'<details><summary>Recovery material</summary><p class="mmo-value">'+esc(r.recoveryPath)+'</p></details>':'')).join('');
  node.innerHTML='<h3>Repair results</h3><p role="status">'+resolved+' resolved · '+remaining+' remaining'+(checking?' · '+checking+' applied, checking':'')+(unverified?' · '+unverified+' unverified':'')+'</p>'+ (rows.length===1?entries:'<details'+(expanded?' open':'')+'><summary>Results ('+rows.length+')</summary>'+entries+'</details>')+'<div class="mmo-actions">'+nativeButton('Check again','data-issue-result-check')+'</div>';
  if(focused)node.querySelector('[data-issue-result-check]').focus({preventScroll:true});
}
async function checkIssueResolution(){
  if(!issueVerification||!page.isConnected||ui.view!=='issues'||!['list','issue'].includes(ui.screen))return;
  clearTimeout(issueCheckTimer);issueCheckTimer=null;
  const verification=issueVerification,serial=++issueCheckSerial,listSerial=++ui.issueRequest;
  try{
    const [status,data]=await Promise.all([api('status'),api('manager/issues')]);
    if(serial!==issueCheckSerial||verification!==issueVerification||!page.isConnected)return;
    if(listSerial!==ui.issueRequest){
      issueCheckTimer=setTimeout(()=>void checkIssueResolution(),5000);
      return;
    }
    // Resolution requires a successful fresh audit and settled worker, never a vanished row alone.
    const expected=verification.result.revision;
    const pending=!!(status.pending||status.refreshPending)||(typeof expected==='number' && (data.revision<expected || status.revision<expected)), timedOut=Date.now()-verification.started>=60000;
    issueItems=data.items;issueArchived=data.archivedReports;ui.issueLoaded=true;renderIssues();q("mmoIssuesMessage").textContent=issueItems.length+" findings across all views.";
    for(const row of verification.rows){
      const outcome=(verification.result.cleanupResults||[]).find(o=>o.id.replaceAll('-','')===row.issue.itemId?.replaceAll('-',''));
      row.recoveryPath=outcome?.recoveryPath;
      const still=data.items.some(i=>i.key===row.issue.key), audit=data.items.some(i=>i.type==='audit'&&(row.issue.type==='credit'||i.itemId===row.issue.itemId));
      if(outcome&&outcome.outcome!=='deleted'){row.state='Still needs attention';row.reason=outcome.reason;}
      else if(pending){row.state=timedOut?'Couldn’t verify yet':'Applied · checking';row.reason=timedOut?'Processing remains pending. Check again when it finishes.':'';}
      else if(audit&&row.issue.type!=='audit'){row.state='Couldn’t verify yet';row.reason='Inspection did not complete for affected items.';}
      else{row.state=still?'Still needs attention':'Resolved';row.reason=still?'A fresh check still finds this condition.':'';}
    }
    renderIssueResults();
    if(pending&&!timedOut)issueCheckTimer=setTimeout(()=>void checkIssueResolution(),5000);
  }catch(error){
    if(serial!==issueCheckSerial||verification!==issueVerification)return;
    if(listSerial!==ui.issueRequest){issueCheckTimer=setTimeout(()=>void checkIssueResolution(),5000);return;}
    for(const row of verification.rows){row.state='Couldn’t verify yet';row.reason='The issue check failed. Check again; no writes are retried.';}renderIssueResults();
  }
}
q('mmoIssueResults').onclick=e=>{if(e.target.closest('[data-issue-result-check]'))perform(()=>{if(issueVerification)issueVerification.started=Date.now();return checkIssueResolution();});};
for(const event of ['pagehide','viewhide','viewbeforehide'])page.addEventListener(event,stopIssueVerification);
for(const event of ['pageshow','viewshow'])page.addEventListener(event,()=>{if(issueVerification&&ui.view==='issues')void checkIssueResolution();});
const issueRouteChanged=()=>{if(!location.hash.toLowerCase().includes('configurationpage?name=musicmetadatamanager'))stopIssueVerification();};
window.addEventListener('hashchange',issueRouteChanged);
const issueDetached=new MutationObserver(()=>{if(!page.isConnected){stopIssueVerification();issueDetached.disconnect();window.removeEventListener('hashchange',issueRouteChanged);}});
issueDetached.observe(document.body,{childList:true,subtree:true});
