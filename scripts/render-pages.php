<?php
/* CLI render harness for the RunnerFarm* tab pages — no Unraid box needed.
   Stubs the Dynamix runtime (parse_plugin_cfg, autov, $var), evals each child
   page body the way DefaultPageLayout would (all in ONE process, mirroring the
   one-request-renders-all-tabs behavior), and asserts the structural
   invariants the UI depends on. Run from the repo root:

       php scripts/render-pages.php [profile]

   Exit code 0 = all assertions passed. */

error_reporting(E_ALL & ~E_DEPRECATED);

$root   = dirname(__DIR__);
$plgdir = "$root/src/usr/local/emhttp/plugins/ci-runner-farm";

// ---- Dynamix stubs ----------------------------------------------------------
function parse_plugin_cfg($plugin, $showPass = false) {
  $path = "/boot/config/plugins/$plugin/$plugin.cfg";
  return function_exists('crf_parse_cfg') && is_file($path) ? crf_parse_cfg($path) : [];
}
function autov($p) { return $p; }
$var = ['csrf_token' => 'harness-csrf'];
$_GET['profile'] = $argv[1] ?? 'default';

// page-common.php lives at the real runtime path in its require_once line —
// alias the packaged tree to that path if we can, else rewrite on the fly.
$runtime = '/usr/local/emhttp/plugins/ci-runner-farm';
$rewrite = !is_dir($runtime);

$children = [
  'RunnerFarmOverview.page',
  'RunnerFarmGitHub.page',
  'RunnerFarmRunners.page',
  'RunnerFarmImage.page',
  'RunnerFarmStorage.page',
];

$html = '';
foreach ($children as $file) {
  $src = file_get_contents("$plgdir/$file");
  if ($src === false) { fwrite(STDERR, "FAIL: missing $file\n"); exit(1); }
  $body = preg_split('/\n---\n/', $src, 2)[1] ?? '';
  if ($rewrite) $body = str_replace($runtime, $plgdir, $body);
  ob_start();
  eval('?>' . $body);
  $html .= "\n<!-- ==== $file ==== -->\n" . ob_get_clean();
}

// ---- assertions ---------------------------------------------------------------
$failures = [];
function check($cond, $msg) { global $failures; if (!$cond) $failures[] = $msg; }

// 1. Every config field appears exactly once across the four forms.
$fields = [
  'GH_SCOPE','GH_OWNER','GH_REPOS','RUNNER_GROUP',
  'RUNNER_COUNT','RUNNER_LABELS','RUNNER_CPUS','RUNNER_MEMORY','EPHEMERAL','RUN_AS_ROOT',
  'AUTOSCALE','AUTOSCALE_MIN','AUTOSCALE_MAX','AUTOSCALE_MIN_IDLE','AUTOSCALE_STEP','AUTOSCALE_INTERVAL','AUTOSCALE_IDLE_GRACE',
  'IMAGE_SOURCE','IMAGE','REGISTRY_SERVER','REGISTRY_USERNAME',
  'IMAGE_AUTOUPDATE','IMAGE_AUTOUPDATE_INTERVAL','IMAGE_DRAIN_TIMEOUT',
  'CACHE_ROOT','WORK_TMPFS_SIZE','CACHE_MOUNTS','DIND','SHARE_DOCKER_SOCK','NETWORK_ISOLATION',
];
foreach ($fields as $f) {
  $n = preg_match_all('/name="'.$f.'"/', $html);
  check($n === 1, "field $f appears $n times (want 1)");
}

// 2. Shared assets emitted exactly once for the whole request.
check(preg_match_all('/window\.CRF =/', $html) === 1, 'window.CRF must be emitted exactly once');
check(preg_match_all('/runner-farm\.js/', $html) === 1, 'runner-farm.js must be included exactly once');
check(preg_match_all('/runner-farm\.css/', $html) === 1, 'runner-farm.css must be included exactly once');

// 3. Profile switcher on every tab (5 copies), classes not ids.
check(preg_match_all('/class="crf-profiles"/', $html) === 5, 'profile switcher must render once per tab (5)');
check(strpos($html, 'id="crf-profiles"') === false, 'profile switcher must not use ids');

// 4. Four forms, each with the right per-profile #file target.
$profile = $_GET['profile'];
$expectFile = ($profile === 'default') ? 'ci-runner-farm/ci-runner-farm.cfg' : "ci-runner-farm/$profile.cfg";
check(preg_match_all('/name="#file" value="'.preg_quote($expectFile, '/').'"/', $html) === 4,
  "each of the 4 forms must target $expectFile");

// 5. Unique interactive ids appear exactly once each.
foreach (['crf-setup','crf-cards','crf-table','crf-meta','crf-action-log','crf-n',
          'crf-sec','crf-warn','crf-tok','crf-token','crf-remote-auth','crf-regtok',
          'crf-registry-token','crf-dockerfile','crf-build-status','crf-build-log','CACHE_ROOT'] as $id) {
  $n = preg_match_all('/id="'.$id.'"/', $html);
  check($n === 1, "id $id appears $n times (want 1)");
}

// 6. The old shared log id is gone.
check(strpos($html, 'id="crf-log"') === false, 'legacy shared #crf-log must not exist');

// 7. Parent page: xmenu + Tabs, and children reference it with ranks 1..5.
$parent = file_get_contents("$plgdir/RunnerFarm.page");
check((bool)preg_match('/^Type="xmenu"$/m', $parent), 'parent must be Type="xmenu"');
check((bool)preg_match('/^Tabs="true"$/m', $parent), 'parent must set Tabs="true"');
foreach ($children as $i => $file) {
  $head = file_get_contents("$plgdir/$file");
  $rank = $i + 1;
  check((bool)preg_match('/^Menu="RunnerFarm:'.$rank.'"$/m', $head), "$file must set Menu=\"RunnerFarm:$rank\"");
}

// ---- report -------------------------------------------------------------------
if ($failures) {
  foreach ($failures as $f) fwrite(STDERR, "FAIL: $f\n");
  fwrite(STDERR, count($failures)." assertion(s) failed for profile '$profile'\n");
  exit(1);
}
echo "OK: all assertions passed for profile '$profile' (".strlen($html)." bytes rendered)\n";
