/* CI Runner Farm — fleet console client (single page: console + drawer + wizard).
   Inlined once by crf_emit_assets(). Config from window.CRF. */

function crfCsrf(){
  return (typeof csrf_token !== 'undefined' && csrf_token) ? csrf_token : ((window.CRF && CRF.csrf) || '');
}
function crfPost(p){
  if (!window.CRF || !CRF.url) return Promise.reject(new Error('CI Runner Farm JS config missing (window.CRF)'));
  if (p.profile === undefined) p.profile = CRF.profile;
  p.csrf_token = crfCsrf();
  if (window.jQuery) {
    return new Promise(function(resolve, reject){
      jQuery.post(CRF.url, p)
        .done(function(data){
          if (typeof data === 'string') {
            try { data = JSON.parse(data); }
            catch (e) { reject(new Error('non-JSON response from exec.php')); return; }
          }
          resolve(data);
        })
        .fail(function(xhr){
          var msg = 'request failed';
          try { var body = JSON.parse(xhr.responseText); if (body && body.error) msg = body.error; } catch (e) {}
          if (xhr.status) msg += ' (HTTP '+xhr.status+')';
          reject(new Error(msg));
        });
    });
  }
  return fetch(CRF.url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:Object.entries(p).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&')})
    .then(function(r){ return r.json().then(function(d){ if (!r.ok) throw new Error((d && d.error) || ('HTTP '+r.status)); return d; }); });
}
function crfFail(err, where){
  var msg = (err && err.message) ? err.message : String(err || 'unknown error');
  console.error('[ci-runner-farm]', where || 'request', err);
  crfShowErr('Error'+(where ? ' ('+where+')' : '')+': '+msg);
  var el = document.getElementById('crf-action-log');
  if (el) el.textContent = 'Error'+(where ? ' ('+where+')' : '')+': '+msg;
}
function crfShowErr(msg){
  var b = document.getElementById('crf-err');
  if (!b) return;
  if (!msg) { b.style.display = 'none'; b.textContent = ''; return; }
  b.textContent = msg;
  b.style.display = 'block';
}
function crfClearErr(){ crfShowErr(''); }

function crfAddProfile(){
  swal({
    title:'Add profile', text:'Letters, numbers, hyphens - max 32 chars. The new profile starts as a copy of default\'s settings.',
    type:'input', inputPlaceholder:'e.g. my-project',
    showCancelButton:true, closeOnConfirm:false, confirmButtonText:'Create'
  }, function(name){
    if (name === false) return;
    if (!name) { swal.showInputError('Enter a profile name'); return; }
    crfPost({action:'add-profile', new_profile:name}).then(function(o){
      if (o.ok) { window.location.href = '?profile='+encodeURIComponent(name); }
      else { swal.showInputError('Could not add profile: '+(o.error||'unknown error')); }
    }).catch(function(e){ crfFail(e, 'add-profile'); });
  });
}
function crfDeleteProfile(){
  if (CRF.profile === 'default') return;
  swal({
    title:'Delete profile "'+CRF.profile+'"?',
    text:'Removes its config, token, and Dockerfile. The fleet must already be stopped.',
    type:'warning', showCancelButton:true, confirmButtonText:'Delete', closeOnConfirm:false
  }, function(confirmed){
    if (!confirmed) return;
    crfPost({action:'delete-profile', del_profile:CRF.profile}).then(function(o){
      if (o.ok) { window.location.href = '?profile=default'; }
      else { swal('Could not delete profile', o.error||'unknown error', 'error'); }
    }).catch(function(e){ crfFail(e, 'delete-profile'); });
  });
}

function crfActionLog(o){ var el=document.getElementById('crf-action-log'); if(el) el.textContent = (o.log||JSON.stringify(o)); }
function crfBuildLog(txt){ var el=document.getElementById('crf-build-log'); if(el) el.textContent = txt; }

function crfAction(a){
  if (a === 'start') {
    var startBtn = document.getElementById('crf-start');
    if (startBtn && startBtn.disabled) {
      crfShowErr(startBtn.title || 'Finish setup before Start');
      return;
    }
  }
  crfClearErr();
  crfPost({action:a}).then(function(o){
    crfActionLog(o);
    if (o && o.ok === false) {
      crfShowErr((a||'action')+' failed'+(o.error ? ': '+o.error : '')+(o.log ? ' — see log below' : ''));
    }
    crfRefresh();
  }).catch(function(e){ crfFail(e, a); });
}
function crfScale(){ var n=document.getElementById('crf-n'); if(!n) return;
  crfClearErr();
  crfPost({action:'scale',n:n.value}).then(function(o){
    crfActionLog(o);
    if (o && o.ok === false) crfShowErr('Scale failed'+(o.error ? ': '+o.error : ''));
    crfRefresh();
  }).catch(function(e){ crfFail(e, 'scale'); });
}

function crfSetToken(){ var i=document.getElementById('crf-token'); if(!i||!i.value) return;
  crfPost({action:'set-token',token:i.value}).then(function(o){
    var s=document.getElementById('crf-tok'); if(s) s.innerHTML=o.ok?'configured &#10004;':'error';
    var w=document.getElementById('crf-wiz-tok'); if(w) w.innerHTML=o.ok?'configured &#10004;':'error';
    i.value=''; CRF.hasToken = !!o.ok; crfRefresh();
  }).catch(function(e){ crfFail(e, 'set-token'); }); }
function crfClearToken(){ crfPost({action:'clear-token'}).then(function(){
    var s=document.getElementById('crf-tok'); if(s) s.innerHTML='not set';
    var w=document.getElementById('crf-wiz-tok'); if(w) w.innerHTML='not set';
    CRF.hasToken = false; crfRefresh();
  }).catch(function(e){ crfFail(e, 'clear-token'); }); }
function crfSetRegistryToken(){ var i=document.getElementById('crf-registry-token'); if(!i||!i.value) return;
  crfPost({action:'set-registry-token',token:i.value}).then(function(o){
    var s=document.getElementById('crf-regtok'); if(s) s.innerHTML=o.ok?'configured &#10004;':'error';
    i.value='';
  }).catch(function(e){ crfFail(e, 'set-registry-token'); }); }
function crfClearRegistryToken(){ crfPost({action:'clear-registry-token'}).then(function(){
    var s=document.getElementById('crf-regtok'); if(s) s.innerHTML='';
  }).catch(function(e){ crfFail(e, 'clear-registry-token'); }); }

function crfResetDefaults(btn){
  var form = btn && btn.closest ? btn.closest('form') : document.getElementById('crf-settings-form');
  if (!form) return;
  var touchedImgSrc = false;
  for (var k in CRF.defaults){
    var el = form.elements[k];
    if (!el) continue;
    el.value = CRF.defaults[k];
    el.dispatchEvent(new Event('change', {bubbles:true}));
    if (k === 'IMAGE_SOURCE') touchedImgSrc = true;
  }
  if (touchedImgSrc) crfImgSrc();
}

function crfIeStatus(msg, ok){
  var s=document.getElementById('crf-ie-status');
  if (!s) return;
  s.textContent = msg || '';
  s.style.color = ok === false ? '#c44' : (ok ? '#3a7' : '#888');
}

function crfExportConfig(){
  crfIeStatus('Exporting…');
  crfPost({action:'export-config'}).then(function(o){
    if (!o || !o.ok || !o.bundle) throw new Error((o && o.error) || 'export failed');
    var ta=document.getElementById('crf-ie-json');
    if (ta) ta.value = JSON.stringify(o.bundle, null, 2);
    crfIeStatus('Exported — Copy and paste into chat for help.', true);
  }).catch(function(e){ crfIeStatus(String(e.message||e), false); crfFail(e, 'export-config'); });
}

function crfCopyExport(){
  var ta=document.getElementById('crf-ie-json');
  if (!ta || !ta.value) { crfIeStatus('Nothing to copy — Export first.', false); return; }
  var done=function(){ crfIeStatus('Copied to clipboard.', true); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(done).catch(function(){
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { crfIeStatus('Select the text and copy manually.', false); }
    });
  } else {
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { crfIeStatus('Select the text and copy manually.', false); }
  }
}

function crfImportConfig(){
  var ta=document.getElementById('crf-ie-json');
  if (!ta || !ta.value.trim()) { crfIeStatus('Paste an export JSON first.', false); return; }
  var raw=ta.value.trim();
  var bundle;
  try { bundle = JSON.parse(raw); } catch (e) {
    crfIeStatus('Invalid JSON — check for missing commas or quotes.', false);
    return;
  }
  // Accept either the bare bundle or {ok, bundle} from an accidental paste of the API response.
  if (bundle && bundle.bundle && typeof bundle.bundle === 'object') bundle = bundle.bundle;
  if (!bundle || bundle.format !== 'ci-runner-farm-export') {
    crfIeStatus('Not a CI Runner Farm export (missing format).', false);
    return;
  }
  if (bundle.profile && bundle.profile !== CRF.profile) {
    crfIeStatus('This export is for profile "'+bundle.profile+'" — switch to that profile first (current: '+CRF.profile+').', false);
    return;
  }
  var settings = bundle.settings || {};
  var form=document.getElementById('crf-settings-form');
  if (!form) { crfIeStatus('Settings form missing.', false); return; }
  var n=0, touchedImgSrc=false;
  for (var k in settings){
    if (!Object.prototype.hasOwnProperty.call(settings, k)) continue;
    if (!(k in CRF.defaults)) continue;
    var el=form.elements[k];
    if (!el) continue;
    el.value = String(settings[k]);
    el.dispatchEvent(new Event('change', {bubbles:true}));
    n++;
    if (k === 'IMAGE_SOURCE') touchedImgSrc = true;
  }
  if (touchedImgSrc) crfImgSrc();
  var hasDf = typeof bundle.dockerfile === 'string' && bundle.dockerfile !== '';
  if (hasDf) {
    var df=document.getElementById('crf-dockerfile');
    if (df) df.value = bundle.dockerfile;
  }
  var finish = function(dfSaved){
    var parts = ['Loaded '+n+' setting(s)'];
    if (hasDf) parts.push(dfSaved ? 'Dockerfile saved' : 'Dockerfile in builder');
    parts.push('Click Apply to write settings');
    if (hasDf && dfSaved) parts.push('then Build image');
    crfIeStatus(parts.join(' — ') + '.', true);
  };
  if (hasDf) {
    crfIeStatus('Saving Dockerfile…');
    crfPost({action:'save-dockerfile', dockerfile:bundle.dockerfile}).then(function(o){
      if (!o || !o.ok) throw new Error((o && o.error) || 'save-dockerfile failed');
      var s=document.getElementById('crf-build-status'); if(s) s.textContent='saved';
      finish(true);
    }).catch(function(e){
      crfIeStatus('Settings loaded, but Dockerfile save failed: '+(e.message||e)+'. Click Save Dockerfile manually.', false);
      crfFail(e, 'import-save-dockerfile');
    });
  } else {
    finish(false);
  }
}

function crfImgSrc(){
  var sel=document.getElementById('IMAGE_SOURCE') || document.getElementsByName('IMAGE_SOURCE')[0];
  var remote=sel&&sel.value==='remote';
  var disp=remote?'':'none';
  var imgRow=document.getElementById('crf-row-image'); if(imgRow) imgRow.style.display=disp===''?'':'none';
  ['crf-row-reg-server','crf-row-reg-user'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.style.display=disp===''?'':'none';
  });
  var auth=document.getElementById('crf-remote-auth'); if(auth) auth.style.display=disp;
  var wizRow=document.getElementById('crf-wiz-image-row');
  var wizSrc=document.getElementById('crf-wiz-imgsrc');
  if (wizRow && wizSrc) wizRow.style.display = wizSrc.value==='remote' ? '' : 'none';
}

/* ---- in-page views (no fixed overlays) ---- */
function crfShowView(name){
  var app=document.getElementById('crf-app');
  if (!app) return;
  var views=['console','settings','wizard'];
  if (views.indexOf(name) < 0) name='console';
  app.className = 'crf-app crf-view-'+name;
  views.forEach(function(v){
    var el=document.getElementById('crf-view-'+v);
    if (!el) return;
    var on = v === name;
    if (on) { el.removeAttribute('hidden'); el.style.display=''; }
    else { el.setAttribute('hidden',''); el.style.display='none'; }
  });
  window.scrollTo(0,0);
}
function crfOpenDrawer(){ crfShowView('settings'); }
function crfCloseDrawer(){ crfShowView('console'); }

/* ---- wizard ---- */
var crfWizStep = 0;
var crfWizSkipped = false;
var crfWizLabels = ['Token','Target','Cache','Image','Launch'];

function crfWizardSyncFromForm(){
  var form=document.getElementById('crf-settings-form'); if(!form) return;
  var scope=document.getElementById('crf-wiz-scope');
  var owner=document.getElementById('crf-wiz-owner');
  var repos=document.getElementById('crf-wiz-repos');
  var cache=document.getElementById('crf-wiz-cache');
  var imgsrc=document.getElementById('crf-wiz-imgsrc');
  var image=document.getElementById('crf-wiz-image');
  if (scope && form.GH_SCOPE) scope.value = form.GH_SCOPE.value;
  if (owner && form.GH_OWNER) owner.value = form.GH_OWNER.value;
  if (repos && form.GH_REPOS) repos.value = form.GH_REPOS.value;
  if (cache && form.CACHE_ROOT) cache.value = form.CACHE_ROOT.value;
  if (imgsrc && form.IMAGE_SOURCE) imgsrc.value = form.IMAGE_SOURCE.value;
  if (image && form.IMAGE) image.value = form.IMAGE.value;
  crfImgSrc();
}
function crfWizardSyncToForm(){
  var form=document.getElementById('crf-settings-form'); if(!form) return;
  var scope=document.getElementById('crf-wiz-scope');
  var owner=document.getElementById('crf-wiz-owner');
  var repos=document.getElementById('crf-wiz-repos');
  var cache=document.getElementById('crf-wiz-cache');
  var imgsrc=document.getElementById('crf-wiz-imgsrc');
  var image=document.getElementById('crf-wiz-image');
  if (scope && form.GH_SCOPE) form.GH_SCOPE.value = scope.value;
  if (owner && form.GH_OWNER) form.GH_OWNER.value = owner.value;
  if (repos && form.GH_REPOS) form.GH_REPOS.value = repos.value;
  if (cache && form.CACHE_ROOT) form.CACHE_ROOT.value = cache.value;
  if (imgsrc && form.IMAGE_SOURCE) { form.IMAGE_SOURCE.value = imgsrc.value; }
  if (image && form.IMAGE) form.IMAGE.value = image.value;
  crfImgSrc();
}
function crfRenderWizardPills(){
  var el=document.getElementById('crf-wizard-pills'); if(!el) return;
  el.innerHTML = crfWizLabels.map(function(l,i){
    var tone = i < crfWizStep ? 'pass' : (i === crfWizStep ? 'now' : 'todo');
    return '<span class="crf-wiz-pill crf-wiz-pill-'+tone+'">'+(i+1)+'. '+l+'</span>';
  }).join(' ');
  var lab=document.getElementById('crf-wizard-step-label');
  if (lab) lab.textContent = 'Step '+(crfWizStep+1)+' of '+crfWizLabels.length;
  document.querySelectorAll('.crf-wizard-pane').forEach(function(p){
    p.style.display = (String(p.getAttribute('data-step')) === String(crfWizStep)) ? '' : 'none';
  });
  var back=document.getElementById('crf-wiz-back');
  var next=document.getElementById('crf-wiz-next');
  if (back) back.disabled = crfWizStep === 0;
  if (next) next.value = crfWizStep === crfWizLabels.length-1 ? 'Save & Launch' : 'Continue';
}
function crfOpenWizard(){
  crfWizSkipped = false;
  try { sessionStorage.removeItem('crf-wiz-skip-'+CRF.profile); } catch (e) {}
  crfWizardSyncFromForm();
  crfWizStep = 0;
  crfShowView('wizard');
  crfRenderWizardPills();
}
function crfCloseWizard(silent){
  crfShowView('console');
}
function crfSkipWizard(){
  crfWizSkipped = true;
  try { sessionStorage.setItem('crf-wiz-skip-'+CRF.profile, '1'); } catch (e) {}
  crfShowView('console');
}
function crfWizardSaveToken(){
  var i=document.getElementById('crf-wiz-token'); if(!i||!i.value) return;
  crfPost({action:'set-token',token:i.value}).then(function(o){
    var s=document.getElementById('crf-tok'); if(s) s.innerHTML=o.ok?'configured &#10004;':'error';
    var w=document.getElementById('crf-wiz-tok'); if(w) w.innerHTML=o.ok?'configured &#10004;':'error';
    i.value=''; CRF.hasToken = !!o.ok; crfRefresh();
  }).catch(function(e){ crfFail(e, 'set-token'); });
}
function crfWizardBack(){
  if (crfWizStep > 0) { crfWizStep--; crfRenderWizardPills(); }
}
function crfApplySettingsForm(){
  var form=document.getElementById('crf-settings-form');
  if (!form) return Promise.reject(new Error('settings form missing'));
  var csrf = form.querySelector('[name=csrf_token]');
  if (csrf) csrf.value = crfCsrf();
  form.submit();
  return new Promise(function(resolve){ setTimeout(resolve, 900); });
}
function crfWizardNext(){
  if (crfWizStep < 4) {
    if (crfWizStep === 1 || crfWizStep === 2 || crfWizStep === 3) crfWizardSyncToForm();
    crfWizStep++;
    crfRenderWizardPills();
    return;
  }
  crfWizardSyncToForm();
  var hint=document.getElementById('crf-wiz-launch-hint');
  if (hint) hint.textContent = 'Saving settings…';
  crfApplySettingsForm().then(function(){
    if (hint) hint.textContent = 'Starting fleet…';
    crfShowView('console');
    crfClearErr();
    return crfPost({action:'start'});
  }).then(function(o){
    crfActionLog(o);
    if (o && o.ok === false) {
      crfShowErr('start failed'+(o.error ? ': '+o.error : '')+(o.log ? ' — see log below' : ''));
    }
    crfRefresh();
  }).catch(function(e){ crfFail(e, 'wizard-launch'); });
}

function crfMaybeAutoWizard(d){
  if (crfWizSkipped) return;
  try { if (sessionStorage.getItem('crf-wiz-skip-'+CRF.profile) === '1') return; } catch (e) {}
  var fresh = !d.token && !(d.count > 0);
  var app=document.getElementById('crf-app');
  var onWizard = app && app.classList.contains('crf-view-wizard');
  if (fresh && !onWizard) crfOpenWizard();
}

/* ---- readiness / console status ---- */
function crfChecklistSteps(d){
  return [
    { label:'Save a GitHub token', pass: d.token === true },
    { label:'Point at your repository', pass: d.target_ok === true },
    { label:'Pick a valid cache root', pass: !d.warning },
    { label:'Runner image ready', pass: d.image_ready === true },
    { label:'Start the fleet', pass: (d.count||0) > 0 },
  ];
}
function crfSetupReady(d){
  var steps=crfChecklistSteps(d);
  for (var i=0; i<4; i++) {
    if (!steps[i].pass) return { ok:false, step:steps[i] };
  }
  return { ok:true, step:null };
}
function crfUpdateControls(d){
  var ready = crfSetupReady(d);
  var count = d.count || 0;
  var start = document.getElementById('crf-start');
  var stop = document.getElementById('crf-stop');
  var restart = document.getElementById('crf-restart');
  var hint = document.getElementById('crf-start-hint');
  var chip = document.getElementById('crf-setup-chip');
  var chipText = document.getElementById('crf-setup-chip-text');
  if (start) {
    start.disabled = !ready.ok;
    start.title = ready.ok
      ? 'Start the fleet'
      : ('Finish setup first: '+(ready.step && ready.step.label ? ready.step.label : 'checklist'));
  }
  if (hint) {
    if (ready.ok) { hint.style.display = 'none'; hint.textContent = ''; }
    else {
      hint.style.display = '';
      hint.textContent = 'Start is disabled until: '+(ready.step && ready.step.label ? ready.step.label : 'setup is complete')+'.';
    }
  }
  if (chip) {
    var incomplete = !ready.ok || (count === 0 && !d.token);
    // show chip when setup incomplete but not when wizard is open
    var app=document.getElementById('crf-app');
    var wizOpen = app && app.classList.contains('crf-view-wizard');
    chip.style.display = (!ready.ok && !wizOpen) ? 'flex' : 'none';
    if (chipText && ready.step) chipText.textContent = 'Setup incomplete — '+ready.step.label;
  }
  if (stop) stop.disabled = count === 0;
  if (restart) restart.disabled = count === 0;
}

function crfRenderCards(d){
  var el=document.getElementById('crf-cards'); if(!el) return;
  function card(title,val,cls){ return '<div class="crf-card"><div class="crf-card-title">'+title+'</div><div class="crf-card-value '+(cls||'')+'">'+val+'</div></div>'; }
  var fleetCls = (d.count||0)>0 ? 'crf-ok' : 'crf-dim';
  var runners = d.runners||[];
  var busy = runners.filter(function(r){return r.phase==='busy';}).length;
  var errs = runners.filter(function(r){return r.phase==='error'||r.state!=='running';}).length;
  if (errs>0) fleetCls='crf-bad';
  var tokVal = d.token ? 'configured &#10004;' : 'not set';
  el.innerHTML =
    card('Fleet', (d.count||0)+' / '+(d.configured||0)+' runners'+((d.count||0)>0?' &middot; '+busy+' busy':''), fleetCls)
    + card('Token', tokVal, d.token?'crf-ok':'crf-bad')
    + card('Autoscale', d.autoscale||'off', '')
    + card('Image auto-update', d.image_autoupdate||'off', '');
}

function crfRefresh(){
  crfPost({action:'status-json'}).then(function(d){
    var warn=document.getElementById('crf-warn');
    if(warn){ if(d.warning){ warn.textContent='⚠ '+d.warning; warn.style.display='block'; } else { warn.textContent=''; warn.style.display='none'; } }
    var sec=document.getElementById('crf-sec');
    if(sec){ if(d.security){ sec.textContent='🔒 '+d.security; sec.style.display='block'; } else { sec.textContent=''; sec.style.display='none'; } }
    crfRenderCards(d);
    crfUpdateControls(d);
    crfMaybeAutoWizard(d);
    var meta=document.getElementById('crf-meta');
    if(meta){ meta.textContent='Autoscale: '+(d.autoscale||'off')+'  ·  Image auto-update: '+(d.image_autoupdate||'off'); }
    var tb=document.querySelector('#crf-table tbody');
    if(tb){
      tb.innerHTML='';
      if(!d.runners||!d.runners.length){ tb.innerHTML='<tr><td colspan="5">no managed runners (configured: '+(d.configured||0)+')</td></tr>'; return; }
      d.runners.forEach(function(r){ var cls=r.state!=='running'?'crf-exited':('crf-'+r.phase);
        tb.innerHTML+='<tr><td>'+r.name+'</td><td>'+r.state+'</td><td><span class="crf-pill '+cls+'">'+r.phase+'</span></td><td>'+(r.cpus?r.cpus+'c':'max')+'</td><td>'+r.mem_gb+'g</td></tr>'; });
    }
  }).catch(function(e){
    var tb=document.querySelector('#crf-table tbody');
    if (tb && /loading/i.test(tb.textContent||'')) tb.innerHTML='<tr><td colspan="5">status failed: '+((e&&e.message)||e)+'</td></tr>';
    console.error('[ci-runner-farm] status-json', e);
  });
}

function crfSaveDf(cb){ var ta=document.getElementById('crf-dockerfile'); if(!ta) return;
  crfPost({action:'save-dockerfile',dockerfile:ta.value}).then(function(o){
    var s=document.getElementById('crf-build-status'); if(s) s.textContent = o.ok?'saved':('error: '+(o.error||''));
    if(typeof cb==='function') cb();
  }).catch(function(e){ crfFail(e, 'save-dockerfile'); var s=document.getElementById('crf-build-status'); if(s) s.textContent='error: '+e.message; }); }
function crfBuild(){ var s=document.getElementById('crf-build-status'); if(s) s.textContent='saving + building...';
  crfSaveDf(function(){ crfPost({action:'build-image'}).then(function(){ crfPollBuild(); }).catch(function(e){ crfFail(e, 'build-image'); }); }); }
function crfPollBuild(){ crfPost({action:'build-log'}).then(function(d){
    crfBuildLog(d.log||'');
    var s=document.getElementById('crf-build-status');
    if(d.running){ if(s) s.textContent='building...'; setTimeout(crfPollBuild,2000); }
    else { if(s) s.textContent='build finished — restart the fleet to use it'; crfRefresh(); }
  }).catch(function(e){ crfFail(e, 'build-log'); }); }

/* Legacy no-op kept so old inline handlers never throw */
function crfGoTab(){ /* tabs removed — use drawer/wizard */ }

window.crfCsrf = crfCsrf;
window.crfPost = crfPost;
window.crfFail = crfFail;
window.crfShowErr = crfShowErr;
window.crfClearErr = crfClearErr;
window.crfAddProfile = crfAddProfile;
window.crfDeleteProfile = crfDeleteProfile;
window.crfActionLog = crfActionLog;
window.crfBuildLog = crfBuildLog;
window.crfAction = crfAction;
window.crfScale = crfScale;
window.crfSetToken = crfSetToken;
window.crfClearToken = crfClearToken;
window.crfSetRegistryToken = crfSetRegistryToken;
window.crfClearRegistryToken = crfClearRegistryToken;
window.crfResetDefaults = crfResetDefaults;
window.crfExportConfig = crfExportConfig;
window.crfCopyExport = crfCopyExport;
window.crfImportConfig = crfImportConfig;
window.crfImgSrc = crfImgSrc;
window.crfGoTab = crfGoTab;
window.crfShowView = crfShowView;
window.crfOpenDrawer = crfOpenDrawer;
window.crfCloseDrawer = crfCloseDrawer;
window.crfOpenWizard = crfOpenWizard;
window.crfCloseWizard = crfCloseWizard;
window.crfSkipWizard = crfSkipWizard;
window.crfWizardSaveToken = crfWizardSaveToken;
window.crfWizardBack = crfWizardBack;
window.crfWizardNext = crfWizardNext;
window.crfRefresh = crfRefresh;
window.crfSaveDf = crfSaveDf;
window.crfBuild = crfBuild;
window.crfPollBuild = crfPollBuild;

if (window.jQuery) {
  jQuery(function($){
    if ($.fn.fileTreeAttach) $("#CACHE_ROOT").fileTreeAttach();
    var wizSrc=document.getElementById('crf-wiz-imgsrc');
    if (wizSrc) wizSrc.addEventListener('change', crfImgSrc);
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape') {
        var app=document.getElementById('crf-app');
        if (app && (app.classList.contains('crf-view-settings') || app.classList.contains('crf-view-wizard'))) {
          crfShowView('console');
        }
      }
    });
    crfImgSrc();
    crfRefresh();
    setInterval(crfRefresh, 5000);
  });
} else {
  console.error('[ci-runner-farm] jQuery missing — status poll not started');
}
