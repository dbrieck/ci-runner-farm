/* CI Runner Farm - shared client JS for the RunnerFarm* tab pages.
   Loaded exactly once per request by crf_emit_assets() (page-common.php), so
   there is a single 5s status poll no matter how many tabs are in the DOM.
   Reads its config from window.CRF (csrf, url, profile, defaults, ...).
   All element lookups are null-guarded: every tab's markup coexists in the
   one shared DOM, but this script must not assume any particular tab. */

function crfPost(p){
  p.csrf_token = CRF.csrf;
  if (p.profile === undefined) p.profile = CRF.profile;
  return fetch(CRF.url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:Object.entries(p).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&')}).then(r=>r.json());
}

// ---- profile management (swal dialogs; ?profile= reload mechanism kept) ----
function crfAddProfile(){
  swal({
    title:'Add profile', text:'Letters, numbers, hyphens — max 32 chars. The new profile starts as a copy of default’s settings.',
    type:'input', inputPlaceholder:'e.g. my-project',
    showCancelButton:true, closeOnConfirm:false, confirmButtonText:'Create'
  }, function(name){
    if (name === false) return;                    // cancelled
    if (!name) { swal.showInputError('Enter a profile name'); return; }
    crfPost({action:'add-profile', new_profile:name}).then(function(o){
      if (o.ok) { window.location.href = '?profile='+encodeURIComponent(name); }
      else { swal.showInputError('Could not add profile: '+(o.error||'unknown error')); }
    });
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
    });
  });
}

// ---- logs: fleet-action output (Overview) and image-build output (Image) ----
// are SEPARATE panels so a running build's log is never clobbered by a
// Start/Stop and vice versa.
function crfActionLog(o){ var el=document.getElementById('crf-action-log'); if(el) el.textContent = (o.log||JSON.stringify(o)); }
function crfBuildLog(txt){ var el=document.getElementById('crf-build-log'); if(el) el.textContent = txt; }

function crfAction(a){ crfPost({action:a}).then(function(o){ crfActionLog(o); crfRefresh(); }); }
function crfScale(){ var n=document.getElementById('crf-n'); if(!n) return;
  crfPost({action:'scale',n:n.value}).then(function(o){ crfActionLog(o); crfRefresh(); }); }

// ---- tokens (immediate refresh so the setup checklist flips right away) ----
function crfSetToken(){ var i=document.getElementById('crf-token'); if(!i||!i.value) return;
  crfPost({action:'set-token',token:i.value}).then(function(o){
    var s=document.getElementById('crf-tok'); if(s) s.innerHTML=o.ok?'configured &#10004;':'error';
    i.value=''; crfRefresh();
  }); }
function crfClearToken(){ crfPost({action:'clear-token'}).then(function(){
    var s=document.getElementById('crf-tok'); if(s) s.innerHTML='not set';
    crfRefresh();
  }); }
function crfSetRegistryToken(){ var i=document.getElementById('crf-registry-token'); if(!i||!i.value) return;
  crfPost({action:'set-registry-token',token:i.value}).then(function(o){
    var s=document.getElementById('crf-regtok'); if(s) s.innerHTML=o.ok?'configured &#10004;':'error';
    i.value='';
  }); }
function crfClearRegistryToken(){ crfPost({action:'clear-registry-token'}).then(function(){
    var s=document.getElementById('crf-regtok'); if(s) s.innerHTML='';
  }); }

// ---- per-tab reset to defaults --------------------------------------------
// Resets ONLY the fields inside the invoking tab's form (per-tab Apply means
// per-tab Reset), and dispatches 'change' so Unraid's stock dirty-tracking
// enables that form's Apply button.
function crfResetDefaults(btn){
  var form = btn && btn.closest ? btn.closest('form') : null;
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

// show/hide the remote-only fields (Remote image + registry server/username/token)
// based on the Image source select. Targets each field's <dd>+<dt> (Unraid
// markdown forms are MarkdownExtra definition lists). Hide-only (never disable):
// disabled inputs aren't submitted, which would drop the values on Apply;
// display:none inputs still submit, so values persist when switching modes. If
// the DOM ever differs, the fields simply stay visible — no harm.
function crfImgSrc(){
  var sel=document.getElementsByName('IMAGE_SOURCE')[0];
  var remote=sel&&sel.value==='remote';
  var disp=remote?'':'none';
  ['IMAGE','REGISTRY_SERVER','REGISTRY_USERNAME'].forEach(function(n){
    var el=document.getElementsByName(n)[0]; if(!el) return;
    var dd=el.closest('dd'); var row=dd||el.closest('tr');
    if(row) row.style.display=disp;
    if(dd&&dd.previousElementSibling) dd.previousElementSibling.style.display=disp;
  });
  var auth=document.getElementById('crf-remote-auth'); if(auth) auth.style.display=disp;
}

// ---- tab navigation for the setup checklist's "Go to" links ----------------
// Unraid's tab bar is <nav class="tabs"> with role=tab buttons (client-side
// switching). If the selector doesn't match on some webGUI version, fall back
// to a plain reload — the checklist text still says where to go.
function crfGoTab(n){
  var tabs=document.querySelectorAll('nav.tabs [role=tab]');
  if (tabs && tabs.length >= n) { tabs[n-1].click(); window.scrollTo(0,0); return; }
  window.location.href='?profile='+encodeURIComponent(CRF.profile);
}

// ---- setup checklist --------------------------------------------------------
// The first-run guide on the Overview tab. Purely state-derived from the 5s
// status-json poll: exactly one "do this next" step is highlighted; steps after
// it show as pending; when everything passes it collapses to one line (and
// reappears if anything regresses).
function crfChecklistSteps(d){
  return [
    { label:'Save a GitHub token (PAT)', pass: d.token === true,
      hint:'Create the pre-scoped PAT and save it on the GitHub tab.', tab:2 },
    { label:'Point at your repository', pass: d.target_ok === true,
      hint:'Set the target repo(s) and runner labels on the GitHub tab.', tab:2 },
    { label:'Pick a valid cache root', pass: !d.warning,
      hint: d.warning ? d.warning : 'A pool dataset, e.g. /mnt/cache/github-runner — set on the Storage & Docker tab.', tab:5 },
    { label:'Runner image ready', pass: d.image_ready === true,
      hint: d.image_ready ? (d.image||'') : 'Build the built-in image on the Runner Image tab (or pick a remote image — it pulls on start).', tab:4 },
    { label:'Start the fleet', pass: (d.count||0) > 0,
      hint:'Use the Start button below.', tab:0 },
  ];
}
function crfRenderChecklist(d){
  var box=document.getElementById('crf-setup'); if(!box) return;
  var steps=crfChecklistSteps(d);
  var allPass=steps.every(function(s){return s.pass;});
  if (allPass){
    box.className='crf-setup crf-setup-done';
    box.innerHTML='<span class="crf-check-icon crf-check-pass">&#10004;</span> Setup complete — the fleet is configured and running.';
    return;
  }
  box.className='crf-setup';
  var firstFail=steps.findIndex(function(s){return !s.pass;});
  var html='<div class="crf-setup-title">Setup checklist</div>';
  steps.forEach(function(s,i){
    var state = s.pass ? 'pass' : (i===firstFail ? 'fail' : 'pending');
    var icon  = s.pass ? '&#10004;' : (i===firstFail ? '&#9654;' : '&#8226;');
    html += '<div class="crf-check crf-check-'+state+'">'
          +   '<span class="crf-check-icon">'+icon+'</span>'
          +   '<span class="crf-check-label">'+(i+1)+'. '+s.label+'</span>'
          +   (i===firstFail ? '<span class="crf-check-hint">'+s.hint
          +     (s.tab ? ' <a href="#" onclick="crfGoTab('+s.tab+');return false">Go to tab &rarr;</a>' : '')+'</span>' : '')
          + '</div>';
  });
  box.innerHTML=html;
}

// ---- status cards + runner table (Overview) ---------------------------------
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
    crfRenderChecklist(d);
    crfRenderCards(d);
    var meta=document.getElementById('crf-meta');
    if(meta){ meta.textContent='Autoscale: '+(d.autoscale||'off')+'  ·  Image auto-update: '+(d.image_autoupdate||'off'); }
    var tb=document.querySelector('#crf-table tbody');
    if(tb){
      tb.innerHTML='';
      if(!d.runners||!d.runners.length){ tb.innerHTML='<tr><td colspan="5">no managed runners (configured: '+(d.configured||0)+')</td></tr>'; return; }
      d.runners.forEach(function(r){ var cls=r.state!=='running'?'crf-exited':('crf-'+r.phase);
        tb.innerHTML+='<tr><td>'+r.name+'</td><td>'+r.state+'</td><td><span class="crf-pill '+cls+'">'+r.phase+'</span></td><td>'+(r.cpus?r.cpus+'c':'max')+'</td><td>'+r.mem_gb+'g</td></tr>'; });
    }
  }).catch(function(){});
}

// ---- Dockerfile builder (Image tab) -----------------------------------------
function crfSaveDf(cb){ var ta=document.getElementById('crf-dockerfile'); if(!ta) return;
  crfPost({action:'save-dockerfile',dockerfile:ta.value}).then(function(o){
    var s=document.getElementById('crf-build-status'); if(s) s.textContent = o.ok?'saved':('error: '+(o.error||''));
    if(typeof cb==='function') cb();
  }); }
function crfBuild(){ var s=document.getElementById('crf-build-status'); if(s) s.textContent='saving + building...';
  crfSaveDf(function(){ crfPost({action:'build-image'}).then(function(){ crfPollBuild(); }); }); }
function crfPollBuild(){ crfPost({action:'build-log'}).then(function(d){
    crfBuildLog(d.log||'');
    var s=document.getElementById('crf-build-status');
    if(d.running){ if(s) s.textContent='building...'; setTimeout(crfPollBuild,2000); }
    else { if(s) s.textContent='build finished — restart the fleet to use it'; crfRefresh(); }
  }); }

// ---- boot ---------------------------------------------------------------------
jQuery(function($){
  if ($.fn.fileTreeAttach) $("#CACHE_ROOT").fileTreeAttach();
  crfImgSrc();
  crfRefresh();
  setInterval(crfRefresh, 5000);
});
