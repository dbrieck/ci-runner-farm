<?php
/* CI Runner Farm - backend endpoint for the web UI.
   Guards every action with the Unraid CSRF token, then shells out to
   runner-farm.sh. Token writes go to a chmod-600 file, never a *.cfg file.

   Every fleet-control/config action is scoped to a PROFILE (a named fleet;
   "default" is the original single-fleet behavior and always exists). The
   profile name is validated here (alphanumeric + hyphens, max 32 chars) and
   passed through to runner-farm.sh, which does the same namespacing for
   config/Dockerfile/token/cache paths and container names. */
header('Content-Type: application/json');

$var = @parse_ini_file('/var/local/emhttp/var.ini');
$csrf = $var['csrf_token'] ?? '';
$given = $_REQUEST['csrf_token'] ?? '';
if (!$csrf || !hash_equals($csrf, $given)) {
  http_response_code(403);
  echo json_encode(['ok' => false, 'error' => 'csrf']);
  exit;
}

$PLUGIN  = 'ci-runner-farm';
$CFGDIR  = "/boot/config/plugins/$PLUGIN";
$SCRIPT  = "/usr/local/emhttp/plugins/$PLUGIN/include/runner-farm.sh";
$action  = $_REQUEST['action'] ?? 'status-json';

function run($cmd) { exec($cmd . ' 2>&1', $out, $rc); return [implode("\n", $out), $rc]; }

function valid_profile_name($name) {
  return $name !== '' && strlen($name) <= 32 && preg_match('/^[A-Za-z0-9-]+$/', $name) === 1;
}

// Resolve + validate the profile for every action except the profile-less
// ones (list-profiles, and the registry token, which is host-wide).
$profile = trim($_REQUEST['profile'] ?? 'default');
if ($profile === '') $profile = 'default';
if (!valid_profile_name($profile)) {
  http_response_code(400);
  echo json_encode(['ok' => false, 'error' => 'invalid profile name (alphanumeric + hyphens, max 32 chars)']);
  exit;
}
$isDefault = ($profile === 'default');
$cfgFile   = $isDefault ? "$CFGDIR/$PLUGIN.cfg"      : "$CFGDIR/$profile.cfg";
$tokenFile = $isDefault ? "$CFGDIR/token"             : "$CFGDIR/$profile.token";
$dfFile    = $isDefault ? "$CFGDIR/Dockerfile"        : "$CFGDIR/$profile.Dockerfile";
$buildLog  = $isDefault ? "$CFGDIR/build.log"         : "$CFGDIR/build-$profile.log";
if (!is_file($dfFile)) $dfFile = "/usr/local/emhttp/plugins/$PLUGIN/default.Dockerfile";

switch ($action) {
  case 'list-profiles':
    [$out, $rc] = run(escapeshellarg($SCRIPT) . ' list-profiles');
    $profiles = array_values(array_filter(array_map('trim', explode("\n", $out))));
    if (!in_array('default', $profiles, true)) array_unshift($profiles, 'default');
    echo json_encode(['ok' => $rc === 0, 'profiles' => $profiles]);
    break;

  case 'add-profile':
    $name = trim($_REQUEST['new_profile'] ?? '');
    if (!valid_profile_name($name)) { echo json_encode(['ok'=>false,'error'=>'invalid profile name']); break; }
    if ($name === 'default') { echo json_encode(['ok'=>false,'error'=>'default already exists']); break; }
    $newCfg = "$CFGDIR/$name.cfg";
    if (is_file($newCfg)) { echo json_encode(['ok'=>false,'error'=>'a profile with that name already exists']); break; }
    @mkdir($CFGDIR, 0755, true);
    // Seed the new profile from the current default profile's settings (falling
    // back to the plugin's reference defaults if default has never been saved).
    $srcCfg = is_file("$CFGDIR/$PLUGIN.cfg") ? "$CFGDIR/$PLUGIN.cfg" : "/usr/local/emhttp/plugins/$PLUGIN/default.cfg";
    $ok = is_file($srcCfg) ? copy($srcCfg, $newCfg) : (file_put_contents($newCfg, '') !== false);
    echo json_encode(['ok' => $ok, 'action' => 'add-profile', 'profile' => $name]);
    break;

  case 'delete-profile':
    $name = trim($_REQUEST['del_profile'] ?? $profile);
    if ($name === 'default') { echo json_encode(['ok'=>false,'error'=>'the default profile cannot be deleted']); break; }
    if (!valid_profile_name($name)) { echo json_encode(['ok'=>false,'error'=>'invalid profile name']); break; }
    [$statusOut, ] = run(escapeshellarg($SCRIPT) . ' status-json ' . escapeshellarg($name));
    $status = json_decode($statusOut, true);
    if (is_array($status) && (int)($status['count'] ?? 0) > 0) {
      echo json_encode(['ok'=>false,'error'=>'fleet is running for this profile — Stop it before deleting']);
      break;
    }
    // Stop this profile's daemons first — otherwise a still-running
    // autoscale/image-update loop (e.g. scaled to 0 but the daemon never
    // exited) is orphaned: it keeps running under the now-deleted profile's
    // name with no cfg left to read.
    run(escapeshellarg($SCRIPT) . ' autoscale-stop ' . escapeshellarg($name));
    run(escapeshellarg($SCRIPT) . ' imageupdate-stop ' . escapeshellarg($name));
    foreach ([
      "$CFGDIR/$name.cfg", "$CFGDIR/$name.token", "$CFGDIR/$name.Dockerfile", "$CFGDIR/build-$name.log",
      "$CFGDIR/autoscale-$name.pid", "$CFGDIR/autoscale-$name.log", "$CFGDIR/autoscale-$name.state",
      "$CFGDIR/imageupdate-$name.pid", "$CFGDIR/imageupdate-$name.log",
      "$CFGDIR/security-warn-$name.cache",
    ] as $f) {
      @unlink($f);
    }
    echo json_encode(['ok' => true, 'action' => 'delete-profile', 'profile' => $name]);
    break;

  case 'status-json':
    [$out, $rc] = run(escapeshellarg($SCRIPT) . ' status-json ' . escapeshellarg($profile));
    // runner-farm.sh already emits JSON; pass it through verbatim
    echo $out !== '' ? $out : json_encode(['count'=>0,'runners'=>[]]);
    break;

  case 'start': case 'stop': case 'restart': case 'validate':
    [$out, $rc] = run(escapeshellarg($SCRIPT) . ' ' . escapeshellarg($action) . ' ' . escapeshellarg($profile));
    echo json_encode(['ok' => $rc === 0, 'action' => $action, 'log' => $out]);
    break;

  case 'scale':
    $n = (int)($_REQUEST['n'] ?? 0);
    [$out, $rc] = run(escapeshellarg($SCRIPT) . ' scale ' . escapeshellarg((string)$n) . ' ' . escapeshellarg($profile));
    echo json_encode(['ok' => $rc === 0, 'action' => "scale $n", 'log' => $out]);
    break;

  case 'set-token':
    $tok = trim($_REQUEST['token'] ?? '');
    if ($tok === '') { echo json_encode(['ok'=>false,'error'=>'empty']); break; }
    @mkdir($CFGDIR, 0755, true);
    file_put_contents($tokenFile, $tok);
    chmod($tokenFile, 0600);
    echo json_encode(['ok' => true, 'action' => 'set-token']);
    break;

  case 'clear-token':
    @unlink($tokenFile);
    echo json_encode(['ok' => true, 'action' => 'clear-token']);
    break;

  case 'set-registry-token':
    // Registry auth is host-wide (shared by every profile), not per-profile.
    $tok = trim($_REQUEST['token'] ?? '');
    if ($tok === '') { echo json_encode(['ok'=>false,'error'=>'empty']); break; }
    @mkdir($CFGDIR, 0755, true);
    file_put_contents("$CFGDIR/registry-token", $tok);
    chmod("$CFGDIR/registry-token", 0600);
    echo json_encode(['ok' => true, 'action' => 'set-registry-token']);
    break;

  case 'clear-registry-token':
    @unlink("$CFGDIR/registry-token");
    echo json_encode(['ok' => true, 'action' => 'clear-registry-token']);
    break;

  case 'get-dockerfile':
    echo json_encode(['ok' => true, 'dockerfile' => is_file($dfFile) ? file_get_contents($dfFile) : '']);
    break;

  case 'save-dockerfile':
    $content = $_REQUEST['dockerfile'] ?? '';
    if (trim($content) === '') { echo json_encode(['ok'=>false,'error'=>'empty']); break; }
    @mkdir($CFGDIR, 0755, true);
    $target = $isDefault ? "$CFGDIR/Dockerfile" : "$CFGDIR/$profile.Dockerfile";
    file_put_contents($target, $content);
    echo json_encode(['ok' => true, 'action' => 'save-dockerfile']);
    break;

  case 'build-image':
    // launch the build in the background; UI polls 'build-log'
    exec('nohup ' . escapeshellarg($SCRIPT) . ' build-image ' . escapeshellarg($profile) . ' > ' . escapeshellarg($buildLog) . ' 2>&1 &');
    echo json_encode(['ok' => true, 'action' => 'build-image']);
    break;

  case 'build-log':
    $txt = is_file($buildLog) ? shell_exec('tail -n 100 ' . escapeshellarg($buildLog)) : '';
    // Anchored with a trailing '$' (pgrep -f matches a regex against the full
    // command line): an unanchored pattern would match profile "foo"'s build
    // while checking a profile whose name is a prefix of it, e.g. "f".
    $running = trim(shell_exec("pgrep -f " . escapeshellarg("runner-farm.sh build-image $profile$") . " >/dev/null 2>&1 && echo 1 || echo 0")) === '1';
    echo json_encode(['ok' => true, 'running' => $running, 'log' => $txt]);
    break;

  case 'export-config':
    // Shareable fleet snapshot for support / hand-editing. Never includes PATs
    // or registry passwords — those stay in chmod-600 token files.
    $allow = [
      'GH_SCOPE','GH_OWNER','GH_REPOS','RUNNER_GROUP','RUNNER_COUNT','RUNNER_LABELS',
      'RUNNER_CPUS','RUNNER_MEMORY','EPHEMERAL','RUN_AS_ROOT','IMAGE_SOURCE','IMAGE',
      'REGISTRY_SERVER','REGISTRY_USERNAME','CACHE_ROOT','WORK_TMPFS_SIZE','CACHE_MOUNTS',
      'DIND','SHARE_DOCKER_SOCK','NETWORK_ISOLATION','IMAGE_AUTOUPDATE','IMAGE_AUTOUPDATE_INTERVAL',
      'IMAGE_DRAIN_TIMEOUT','AUTOSCALE','AUTOSCALE_MIN','AUTOSCALE_MAX','AUTOSCALE_MIN_IDLE',
      'AUTOSCALE_STEP','AUTOSCALE_INTERVAL','AUTOSCALE_IDLE_GRACE',
    ];
    $settings = [];
    if (is_file($cfgFile)) {
      foreach (file($cfgFile, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        if (!in_array($k, $allow, true)) continue;
        $v = trim($v);
        if (strlen($v) >= 2 && (($v[0] === '"' && substr($v, -1) === '"') || ($v[0] === "'" && substr($v, -1) === "'"))) {
          $v = substr($v, 1, -1);
        }
        $settings[$k] = $v;
      }
    }
    $customDf = $isDefault ? "$CFGDIR/Dockerfile" : "$CFGDIR/$profile.Dockerfile";
    $df = is_file($customDf) ? file_get_contents($customDf) : '';
    echo json_encode([
      'ok' => true,
      'bundle' => [
        'format'     => 'ci-runner-farm-export',
        'version'    => 1,
        'profile'    => $profile,
        'exportedAt' => gmdate('c'),
        'settings'   => $settings,
        'dockerfile' => $df,
        'secrets'    => [
          'hasToken'         => is_file($tokenFile),
          'hasRegistryToken' => is_file("$CFGDIR/registry-token"),
        ],
      ],
    ]);
    break;

  default:
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'unknown action']);
}
