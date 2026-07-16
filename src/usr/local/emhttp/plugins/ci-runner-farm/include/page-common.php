<?php
/* CI Runner Farm - shared PHP for the RunnerFarm* tab pages.
   All child tabs of the RunnerFarm xmenu parent render in ONE request
   (Unraid emits every tab's panel server-side and switches client-side), so
   this file is require_once'd by each tab: the first include resolves the
   active profile and loads its config, and every later include reuses the
   same globals. Nothing here echoes output except the crf_emit_* helpers. */
if (defined('CRF_PAGE_COMMON')) return;
define('CRF_PAGE_COMMON', 1);

$plugin   = 'ci-runner-farm';
$cfgdir   = "/boot/config/plugins/$plugin";

/* ---- profile resolution ----------------------------------------------------
   A PROFILE is a named fleet: its own cfg/Dockerfile/token, namespaced caches,
   and container names (see runner-farm.sh). "default" is the original
   single-fleet behavior — always present, never deletable — so an existing
   single-fleet install needs zero config changes. The active profile is
   chosen via ?profile=NAME (a plain page reload; Add/Delete reload too), and
   is the same for every tab because all tabs share this one request. */
function crf_valid_profile($name) {
  return $name !== '' && strlen($name) <= 32 && preg_match('/^[A-Za-z0-9-]+$/', $name) === 1;
}
function crf_list_profiles($cfgdir, $plugin) {
  $out = ['default'];
  foreach ((glob("$cfgdir/*.cfg") ?: []) as $f) {
    $name = basename($f, '.cfg');
    if ($name !== $plugin) $out[] = $name;
  }
  return $out;
}
// Read a profile's cfg WITHOUT relying on parse_plugin_cfg (which only knows the
// fixed default filename) — mirrors runner-farm.sh's own bash-side parser
// (KEY="value" lines, '#' comments, blank lines skipped) so both sides agree.
function crf_parse_cfg($path) {
  $out = [];
  if (!is_file($path)) return $out;
  foreach (file($path, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
    $line = trim($line);
    if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
    [$k, $v] = explode('=', $line, 2);
    $k = trim($k);
    if (!preg_match('/^[A-Za-z0-9_]+$/', $k)) continue;
    $v = trim($v);
    if (strlen($v) >= 2 && (($v[0] === '"' && substr($v, -1) === '"') || ($v[0] === "'" && substr($v, -1) === "'"))) {
      $v = substr($v, 1, -1);
    }
    $out[$k] = $v;
  }
  return $out;
}

$profiles = crf_list_profiles($cfgdir, $plugin);
$profile  = trim($_GET['profile'] ?? 'default');
if (!crf_valid_profile($profile) || !in_array($profile, $profiles, true)) $profile = 'default';
$isDefaultProfile = ($profile === 'default');

/* parse_plugin_cfg reads /boot/config/plugins/$plugin/$plugin.cfg (empty [] if
   absent). Defaults are NOT stored on flash — they live in $defaults below, so
   the flash cfg only ever holds what the user actually changed. Non-default
   profiles read their own <profile>.cfg the same way. */
$cfg        = $isDefaultProfile ? parse_plugin_cfg($plugin) : crf_parse_cfg("$cfgdir/$profile.cfg");
$cfgFileRel = $isDefaultProfile ? "$plugin/$plugin.cfg" : "$plugin/$profile.cfg";
$tokenPath  = $isDefaultProfile ? "$cfgdir/token" : "$cfgdir/$profile.token";
$has_token  = file_exists($tokenPath);
$tokenInherited = !$has_token && !$isDefaultProfile && file_exists("$cfgdir/token");
/* Prefer the live session token from $var (Dynamix page scope). Fall back to
   var.ini the same way exec.php does, so CRF.csrf is never empty just because
   $var was missing from an unusual render path. */
$ini      = @parse_ini_file('/var/local/emhttp/var.ini') ?: [];
$csrf     = $var['csrf_token'] ?? $ini['csrf_token'] ?? '';
/* Single source of truth for every form field's default. Drives both the
   rendered fallback (via crf_g/crf_sel) and the client-side per-tab "Reset to
   defaults" buttons (emitted as CRF.defaults), so the two can never drift. */
$defaults = [
  'GH_SCOPE'=>'repo', 'GH_OWNER'=>'', 'GH_REPOS'=>'',
  'RUNNER_GROUP'=>'', 'RUNNER_COUNT'=>'4', 'RUNNER_LABELS'=>'self-hosted,unraid,build',
  'RUNNER_CPUS'=>'', 'RUNNER_MEMORY'=>'16g', 'EPHEMERAL'=>'false', 'RUN_AS_ROOT'=>'false',
  'IMAGE_SOURCE'=>'builtin', 'IMAGE'=>'', 'REGISTRY_SERVER'=>'', 'REGISTRY_USERNAME'=>'',
  'CACHE_ROOT'=>'/mnt/github-runner', 'WORK_TMPFS_SIZE'=>'8g',
  'CACHE_MOUNTS'=>'pnpm-store:/home/runner/.local/share/pnpm/store npm:/home/runner/.npm yarn:/home/runner/.cache/yarn ms-playwright:/home/runner/.cache/ms-playwright',
  'DIND'=>'true', 'SHARE_DOCKER_SOCK'=>'false', 'NETWORK_ISOLATION'=>'off',
  'IMAGE_AUTOUPDATE'=>'false', 'IMAGE_AUTOUPDATE_INTERVAL'=>'1800', 'IMAGE_DRAIN_TIMEOUT'=>'3600',
  'AUTOSCALE'=>'false', 'AUTOSCALE_MIN'=>'2', 'AUTOSCALE_MAX'=>'16', 'AUTOSCALE_MIN_IDLE'=>'2',
  'AUTOSCALE_STEP'=>'2', 'AUTOSCALE_INTERVAL'=>'30', 'AUTOSCALE_IDLE_GRACE'=>'5',
];
$patScope = (($cfg['GH_SCOPE'] ?? $defaults['GH_SCOPE']) === 'org') ? 'repo,admin:org' : 'repo';
$patUrl   = 'https://github.com/settings/tokens/new?description=Unraid+CI+Runner+Farm&scopes='.$patScope;
$dfFile   = $isDefaultProfile ? "$cfgdir/Dockerfile" : "$cfgdir/$profile.Dockerfile";
if (!is_file($dfFile)) $dfFile = "/usr/local/emhttp/plugins/$plugin/default.Dockerfile";
$builtinImageTag = $isDefaultProfile ? "ci-runner-farm-runner:latest" : "ci-runner-farm-runner-$profile:latest";
$dockerfile = is_file($dfFile) ? file_get_contents($dfFile) : '';
/* $defaults is authoritative: the inline $d args at call sites are a fallback
   for any key not listed above (there are none today). */
function crf_g($cfg,$k,$d=''){ global $defaults; return htmlspecialchars($cfg[$k] ?? $defaults[$k] ?? $d, ENT_QUOTES); }
function crf_sel($cfg,$k,$val,$d=''){ global $defaults; return (($cfg[$k] ?? $defaults[$k] ?? $d) === $val) ? 'selected' : ''; }

/* Emit shared CSS/JS and the CRF config blob — exactly ONCE per request.
   CSS is inlined via <style> (Unraid tab panels often strip/mangle <link> in
   body, which left the href path visible and styles unloaded). Dynamix also
   auto-loads sheets/RunnerFarmStatus.css into <head> when present. */
function crf_emit_assets() {
  static $done = false;
  if ($done) return;
  $done = true;
  global $csrf, $profile, $defaults, $has_token, $tokenInherited, $builtinImageTag, $plugin;
  $blob = json_encode([
    'csrf'            => $csrf,
    'url'             => "/plugins/$plugin/include/exec.php",
    'profile'         => $profile,
    'defaults'        => $defaults,
    'hasToken'        => $has_token,
    'tokenInherited'  => $tokenInherited,
    'builtinImageTag' => $builtinImageTag,
  ]);
  $cssPath = __DIR__ . '/../runner-farm.css';
  if (!is_file($cssPath)) $cssPath = "/usr/local/emhttp/plugins/$plugin/runner-farm.css";
  $css = is_file($cssPath) ? file_get_contents($cssPath) : false;
  if ($css !== false && $css !== '') {
    $css = str_replace('</style>', '<\/style>', $css);
    echo "<style id=\"crf-css\">\n{$css}\n</style>\n";
  }
  echo '<script>window.CRF = '.$blob.';</script>'."\n";
  /* Inline like stock Dynamix pages (Notifications.page): handlers must be
     page globals for onclick=. External <script src> inside a tab panel is
     unreliable across Unraid/webGUI versions. Escape </script> so a string
     in the JS file cannot terminate this block early. */
  $jsPath = __DIR__ . '/../runner-farm.js';
  if (!is_file($jsPath)) $jsPath = "/usr/local/emhttp/plugins/$plugin/runner-farm.js";
  $js = is_file($jsPath) ? file_get_contents($jsPath) : false;
  if ($js !== false && $js !== '') {
    $js = str_replace('</script>', '<\/script>', $js);
    echo "<script>\n{$js}\n</script>\n";
  } else {
    echo '<script src="'.autov("/plugins/$plugin/runner-farm.js").'"></script>'."\n";
  }
}

/* The profile switcher bar on the console. Classes only — no ids. */
function crf_profile_switcher() {
  global $profiles, $profile, $isDefaultProfile;
  $multi = count($profiles) > 1;
  /* Single-fleet: minimal chrome. Multi-fleet: full switcher. Add profile
     stays one click away via the details disclosure when only "default". */
  if (!$multi) {
    echo '<div class="crf-profiles crf-profiles-solo">';
    echo '<strong>Fleet:</strong> <code>'.htmlspecialchars($profile, ENT_QUOTES).'</code>';
    echo ' <details class="crf-profiles-more"><summary>More fleets</summary>';
    echo '<p class="crf-profiles-hint">Optional: run a second independent fleet (different repos, labels, or image) alongside this one.</p>';
    echo '<input type="button" value="+ Add profile" onclick="window.crfAddProfile()" style="width:auto">';
    echo '</details></div>'."\n";
    return;
  }
  echo '<div class="crf-profiles"><strong>Fleet profile:</strong>&nbsp;';
  $first = true;
  foreach ($profiles as $p) {
    if (!$first) echo ' ';
    $first = false;
    $active = ($p === $profile);
    $cls = $active ? 'crf-profile crf-profile-active' : 'crf-profile';
    /* Inline styles so pills stay readable even if plugin CSS fails to load. */
    $style = $active
      ? 'display:inline-block;margin:0 6px 4px 0;padding:3px 10px;border-radius:4px;text-decoration:none;background:#3a7;color:#fff;font-weight:bold'
      : 'display:inline-block;margin:0 6px 4px 0;padding:3px 10px;border-radius:4px;text-decoration:none;background:rgba(128,128,128,.2);color:inherit';
    echo '<a class="'.$cls.'" style="'.$style.'" href="?profile='.urlencode($p).'">'.htmlspecialchars($p, ENT_QUOTES).'</a>';
  }
  echo ' <input type="button" value="+ Add profile" onclick="window.crfAddProfile()" style="width:auto">';
  if (!$isDefaultProfile) {
    echo ' <input type="button" value="Delete this profile" onclick="window.crfDeleteProfile()" style="width:auto">';
  }
  echo '<div class="crf-profiles-hint">Each profile is an independent fleet. "default" can\'t be deleted.</div></div>'."\n";
}

/* DORMANT fallback for the /update.php merge question (see PROFILES/UI plan):
   if update.php turns out to TRUNCATE the cfg to just the submitted keys
   (instead of merging), call this inside each tab's form with the list of
   key prefixes that tab owns, and every other key is mirrored as a hidden
   input so no tab's Apply can wipe another tab's settings. Left uncalled
   until hardware verification says it's needed. */
function crf_hidden_mirror(array $ownKeys) {
  global $cfg, $defaults;
  foreach ($defaults as $k => $d) {
    if (in_array($k, $ownKeys, true)) continue;
    echo '<input type="hidden" name="'.$k.'" value="'.crf_g($cfg, $k).'">'."\n";
  }
}
