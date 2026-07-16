<?php
/* CLI render harness for the fleet console — no Unraid box needed.
   Stubs Dynamix (parse_plugin_cfg, autov, $var), evals RunnerFarmStatus.page,
   and asserts console + in-page views + single settings form.
   Run from the repo root:

       php scripts/render-pages.php [profile]

   Exit code 0 = all assertions passed. */

error_reporting(E_ALL & ~E_DEPRECATED);

$root   = dirname(__DIR__);
$plgdir = "$root/src/usr/local/emhttp/plugins/ci-runner-farm";

function parse_plugin_cfg($plugin, $showPass = false) {
  $path = "/boot/config/plugins/$plugin/$plugin.cfg";
  return function_exists('crf_parse_cfg') && is_file($path) ? crf_parse_cfg($path) : [];
}
function autov($p) { return $p; }
$var = ['csrf_token' => 'harness-csrf'];
$_GET['profile'] = $argv[1] ?? 'default';

$runtime = '/usr/local/emhttp/plugins/ci-runner-farm';
$rewrite = !is_dir($runtime);

$pages = ['RunnerFarmStatus.page'];

$html = '';
foreach ($pages as $file) {
  $src = file_get_contents("$plgdir/$file");
  if ($src === false) { fwrite(STDERR, "FAIL: missing $file\n"); exit(1); }
  $parts = preg_split('/\r?\n---\r?\n/', $src, 2);
  $body = $parts[1] ?? '';
  if ($rewrite) $body = str_replace($runtime, $plgdir, $body);
  ob_start();
  eval('?>' . $body);
  $html .= "\n<!-- ==== $file ==== -->\n" . ob_get_clean();
}

$failures = [];
function check($cond, $msg) { global $failures; if (!$cond) $failures[] = $msg; }

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

check(preg_match_all('/window\.CRF =/', $html) === 1, 'window.CRF must be emitted exactly once');
check(preg_match_all('/id="crf-css"/', $html) === 1, 'plugin CSS must be inlined once as #crf-css');
check(strpos($html, 'href="/plugins/ci-runner-farm/runner-farm.css') === false, 'must not emit body <link> to runner-farm.css (shows as text in some Unraid builds)');
check(is_file("$plgdir/sheets/RunnerFarmStatus.css"), 'Dynamix sheets/RunnerFarmStatus.css must exist for head injection');
check(preg_match('/\.crf-view\s*\{/', $html) === 1, 'inlined CSS must include .crf-view rules');
check(preg_match('/function crfAddProfile\s*\(/', $html) === 1, 'runner-farm.js must be inlined once');
check(preg_match('/window\.crfAddProfile\s*=/', $html) === 1, 'crfAddProfile must be exported on window');
check(preg_match('/function crfShowView\s*\(/', $html) === 1, 'crfShowView must be inlined');
check(preg_match('/window\.crfShowView\s*=/', $html) === 1, 'crfShowView must be exported');
check(preg_match('/window\.crfOpenDrawer\s*=/', $html) === 1, 'crfOpenDrawer must be exported');
check(preg_match('/window\.crfOpenWizard\s*=/', $html) === 1, 'crfOpenWizard must be exported');

check(preg_match('/window\.crfExportConfig\s*=/', $html) === 1, 'crfExportConfig must be exported');
check(preg_match('/window\.crfImportConfig\s*=/', $html) === 1, 'crfImportConfig must be exported');
check(strpos($html, 'id="crf-ie-json"') !== false, 'import/export textarea must exist');
check(strpos($html, 'id="crf-import-export"') !== false, 'import/export section must exist');
check(strpos(file_get_contents("$plgdir/include/exec.php"), "case 'export-config':") !== false, 'export-config action must exist in exec.php');

check(preg_match_all('/class="crf-profiles(?:\s|")/', $html) === 1, 'profile switcher once on console');
check(strpos($html, 'id="crf-profiles"') === false, 'profile switcher must not use ids');

$expectFile = 'ci-runner-farm/ci-runner-farm.cfg';
$nForms = preg_match_all('/name="#file" value="'.preg_quote($expectFile, '/').'"/', $html);
check($nForms === 1, "expected 1 settings form targeting $expectFile, got $nForms");

foreach (['crf-app','crf-view-console','crf-view-settings','crf-view-wizard',
          'crf-cards','crf-table','crf-action-log','crf-n','crf-err','crf-start',
          'crf-settings-form','crf-tok','crf-token','CACHE_ROOT','crf-dockerfile'] as $id) {
  $n = preg_match_all('/id="'.$id.'"/', $html);
  check($n === 1, "id $id appears $n times (want 1)");
}

check(strpos($html, 'id="crf-drawer"') === false, 'legacy #crf-drawer overlay must not exist');
check(strpos($html, 'id="crf-drawer-backdrop"') === false, 'drawer backdrop must not exist');
check(strpos($html, 'id="crf-wizard"') === false, 'legacy #crf-wizard overlay id must not exist');
check(strpos($html, 'crfMountOverlays') === false, 'crfMountOverlays must be removed');
check(strpos($html, 'id="crf-log"') === false, 'legacy shared #crf-log must not exist');
check(strpos($html, 'id="crf-setup"') === false, 'old checklist #crf-setup must not exist on console');

$parent = file_get_contents("$plgdir/RunnerFarm.page");
check((bool)preg_match('/^Type="xmenu"$/m', $parent), 'parent must be Type="xmenu"');
check((bool)preg_match('/^Tabs="true"$/m', $parent), 'parent must set Tabs="true"');
check((bool)preg_match('/^Title="CI Runner Farm"$/m', $parent), 'Settings tile title must remain CI Runner Farm');
$parentBody = preg_split('/\r?\n---\r?\n/', $parent, 2)[1] ?? '';
check(trim($parentBody) === '', 'parent body must be empty');

$status = file_get_contents("$plgdir/RunnerFarmStatus.page");
check((bool)preg_match('/^Menu="RunnerFarm:1"$/m', $status), 'Console must be Menu RunnerFarm:1');
check((bool)preg_match('/^Title="Console"$/m', $status), 'Console Title must be Console');
check((bool)preg_match('/^Markdown="false"$/m', $status), 'Console must set Markdown=false');

foreach ([
  'RunnerFarmConnect.page','RunnerFarmCapacity.page','RunnerFarmEnvironment.page',
  'RunnerFarmGitHub.page','RunnerFarmRunners.page','RunnerFarmImage.page',
  'RunnerFarmStorage.page','RunnerFarmOverview.page',
] as $gone) {
  check(!is_file("$plgdir/$gone"), "$gone must be removed");
}

$profile = $_GET['profile'] ?? 'default';
if ($failures) {
  foreach ($failures as $f) fwrite(STDERR, "FAIL: $f\n");
  fwrite(STDERR, count($failures)." assertion(s) failed for profile '$profile'\n");
  exit(1);
}
echo "OK: all assertions passed for profile '$profile' (".strlen($html)." bytes rendered)\n";
