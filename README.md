# CI Runner Farm for Unraid

Turn your Unraid server into a fleet of **GitHub Actions self-hosted runners** —
multiple concurrent, resource-capped runners running as Docker containers, with
warm shared caches, queue-aware autoscaling, and Docker-in-Docker. No VM
required.

Hosted CI minutes are slow and metered. Meanwhile, the Unraid server in your
rack has spare cores and a fast cache pool sitting idle between media tasks.
Point CI Runner Farm at a repo or organization, paste a token, and your builds
run on your own hardware — as many in parallel as your box can handle, with
dependency caches that stay hot between runs, at zero cost per minute.

---

## Why run your own CI?

- **Cost.** Hosted CI bills by the minute. A server you already own runs builds
  for the price of the electricity.
- **Speed.** Run many jobs in parallel and keep pnpm/npm/yarn/Playwright caches
  warm on a local NVMe pool — no re-downloading the world on every run.
- **It's the Unraid thing to do.** Self-hosted runners are just Docker
  containers, and Docker is what your server is already great at. This is "do
  more with the hardware you have," turned up to a build farm.
- **A couple of clicks to install.** It's a normal plugin from Community
  Applications, configured entirely from the webGUI.

---

## What you get

| Capability | What it means |
|---|---|
| **N concurrent runners** | Each runner is its own container, optionally capped with `--cpus` / `--memory` so CI never starves the rest of the host. |
| **Queue-aware autoscaling** | An optional daemon floats the fleet between a min and max based on how many jobs are waiting — capacity when you need it, idle when you don't. |
| **Warm shared caches** | pnpm / npm / yarn / Playwright caches (fully configurable) live on a fast pool and are reused across every run. This is the biggest hidden speed win over hosted CI. |
| **Docker-in-Docker per runner** | Jobs that use `services:` or `docker compose` just work, with an optional shared pull-through registry mirror so images are pulled once for the whole fleet. |
| **Bring your own image** | Use the in-plugin image builder, or point at any image you publish to a registry (public or private). |
| **Multiple fleets (profiles)** | Run independent fleets side by side — different repos, labels, counts, caches, and Dockerfiles. See [PROFILES.md](PROFILES.md). |
| **Tabbed webGUI with guided setup** | An Overview tab walks you through setup step by step (token → repo → cache → image → start) with live pass/fail checks, then gives you fleet controls and per-runner status. Settings are organized into GitHub / Runners / Runner Image / Storage & Docker tabs — no shell required. |

---

## How it works

The plugin provisions a set of Docker containers from a runner image — built
in-plugin or pulled from a registry. Each container registers itself with GitHub
as a self-hosted runner, either at **repo** scope or **org** scope (org scope
gives you one shared pool that any of your private repos can pull from).

Persistent package caches and the build workspace are bind-mounted from a fast
pool so they survive across jobs. An optional companion container runs a
**pull-through registry mirror**, so Docker-in-Docker jobs across the whole fleet
pull each image only once. And an optional autoscaler watches the GitHub job
queue, scaling the fleet up toward your max when work is waiting and back down to
your min when things go quiet.

---

## Install

### Community Applications (recommended)

Search for **CI Runner Farm** in [Community Applications](https://unraid.net/community/apps)
and click **Install**.

### Install by URL

In the Unraid webGUI go to **Plugins → Install Plugin** and paste:

```
https://github.com/unraid/ci-runner-farm/releases/latest/download/ci-runner-farm.plg
```

Unraid always resolves this to the newest published release, and its built-in
"check for updates" keeps the plugin current.

### Installing from a private repo / fork

Both methods above need a **public** release URL — Unraid's plugin installer
downloads anonymously, and a private repo's release assets return 404 without
authentication. Two ways around it:

#### Option A: host on Google Cloud Storage (keeps update checks working)

Serve the two build artifacts from a public GCS bucket — public objects serve
raw bytes at stable URLs, the `.plg`'s MD5 pin makes the hosting location
integrity-neutral, and the package contains no secrets (your token/config live
on flash, never in the tarball). One command does everything (bucket setup if
needed, build, upload, URL):

```sh
gcloud auth login && gcloud config set project <your-project>   # once
./scripts/publish-gcs.sh <bucket-name>                          # every publish
```

It prints the public `.plg` URL to paste into **Plugins → Install Plugin**.
Because the `.plg` is built with `PLUGIN_URL_BASE` pointing at the bucket (and
uploaded with `Cache-Control: no-cache`), Unraid's built-in **check for
updates** keeps working: re-run the script after changes and the plugin
manager offers the update. Costs are effectively zero at ~40KB per version.

`PLUGIN_URL_BASE` works with any static host serving raw bytes, not just GCS:

```sh
PLUGIN_URL_BASE=https://my-host.example/unraid ./build-plg.sh
```

#### Option B: sideload onto flash (no hosting at all)

Copy the package onto flash yourself; the `.plg`'s standard URL/MD5 `<FILE>`
block skips the download whenever the file already exists on flash with a
matching MD5, so the install (and every on-boot reinstall) works entirely
offline:

```sh
./build-plg.sh                       # builds ci-runner-farm.plg + ci-runner-farm.tgz

# copy the package to the exact name the .plg expects, and the .plg to flash
PKG=$(sed -n 's/^<!ENTITY packageName[[:space:]]*"\(.*\)">$/\1/p' ci-runner-farm.plg)
ssh root@tower mkdir -p /boot/config/plugins/ci-runner-farm
scp ci-runner-farm.tgz "root@tower:/boot/config/plugins/ci-runner-farm/$PKG"
scp ci-runner-farm.plg root@tower:/boot/config/plugins/

# install (or reinstall) from the local copy
ssh root@tower plugin install /boot/config/plugins/ci-runner-farm.plg
```

Because the `.plg` and its package live under `/boot/config/plugins/`, Unraid
re-installs the plugin from flash on every boot — no network fetch, no auth
needed. To update, rebuild and repeat (remove the old
`ci-runner-farm-*.tgz` from the config dir first, or let the install script's
own sweep handle it). The one thing you lose versus Option A is the plugin
manager's automatic "check for updates".

For quick dev iteration there's also `./deploy.sh root@tower`, which copies the
plugin tree straight into place — but `/usr/local/emhttp` is RAM-backed, so a
raw deploy does **not** survive a reboot; use the flash install above for
anything you want to keep.

---

## Setup, step by step

You'll need a GitHub Personal Access Token and a fast pool/share for caches.
Everything happens under **Settings → Utilities → CI Runner Farm**, which is
organized into tabs: **Overview · GitHub · Runners · Runner Image · Storage &
Docker**. The **Overview** tab shows a live **setup checklist** that tracks
these exact steps — it highlights the one thing to do next and links to the
right tab, so you can just follow it. A **Fleet profile** switcher at the top
of every tab selects which fleet you're configuring (the `default` profile is
all you need for a single fleet).

### 1. Save your token (GitHub tab)

Create a GitHub **Personal Access Token** with the pre-scoped link on the
GitHub tab (`repo` scope; add `admin:org` for org runners) and save it. It's
stored at `/boot/config/plugins/ci-runner-farm/token` with `chmod 600` and is
**never** written into your plugin config.

### 2. Point it at GitHub (GitHub tab)

Choose your **scope** (`repo` or `org`) and set the **owner** / target repos,
plus an optional **runner group**.

### 3. Size the fleet (Runners tab)

Set how many **concurrent runners** to run, the **runner labels** workflows
target with `runs-on:`, and optional **CPU / memory caps per runner** so CI
can't starve the rest of the box. Optional **queue-aware autoscaling** lives
here too: min/max, a warm idle buffer, step, check interval, and scale-down
grace — the daemon adds runners when jobs are queued and trims idle ones.

### 4. Pick a cache root and Docker mode (Storage & Docker tab)

Point the **cache root** at a real pool dataset (the field has a folder
picker; the checklist warns if the path is unsafe), size the workspace tmpfs,
and configure the **warm caches** (host-subdir → container-path mounts;
defaults cover pnpm/npm/yarn/Playwright). **Docker-in-Docker mode** and
**network isolation** are on the same tab.

### 5. Get a runner image (Runner Image tab)

The **Image source** selector decides where each runner's image comes from:

- **Built-in** (default) — build the image right on the tab with the **Runner
  image builder**. The plugin ships a generic starter
  [`default.Dockerfile`](src/usr/local/emhttp/plugins/ci-runner-farm/default.Dockerfile)
  (stock runner base + a Docker-in-Docker readiness wrapper); customize it —
  add language runtimes, browsers, build tools — then **Build**. Build output
  streams to the panel below the editor. No registry needed.
- **Remote** — pull a named image, e.g. `ghcr.io/org/ci-runner-image:latest`.
  For a private image, set the registry server and username and save a registry
  token; the host runs `docker login` before provisioning. For `ghcr.io`,
  leaving the registry token blank reuses your GitHub token (it just needs
  `read:packages`).

### 6. Start it (Overview tab)

Click **Validate** (no token needed) to confirm the host can provision, then
**Start**. The Overview tab shows status cards, live per-runner status (state,
phase, CPU, memory), and the fleet-action log; the checklist collapses to
"Setup complete ✓". Once started, the runners show up as ordinary Docker
containers (`ci-runner-1…N`), plus the optional `ci-runner-mirror` registry
mirror. Your runners register with GitHub and start picking up jobs.

---

## Security

Self-hosted runners execute arbitrary workflow code on your hardware. Read this
before exposing the fleet:

- DinD runners run `--privileged`, and the shared-socket mode gives runners
  root-equivalent access to the host. Use self-hosted runners **only for
  trusted/private repositories**. Fork-PR code from public repos must **never**
  run on a privileged or socket-mounted self-hosted runner.
- **The plugin actively warns you.** When you Start the fleet (and live on the
  settings page), it checks each repo-scope target's visibility via your token
  and shows a prominent warning if any is **public** while runners are
  privileged. It warns rather than blocks — the call stays yours.
- **`Share host docker.sock` now defaults to off.** Turn it on only for trusted
  private repos; DinD (the default) already covers `services:` without it.
- **Your GitHub token never enters a runner container.** The PAT stays on the
  host; each runner is handed only a short-lived registration token, and runners
  are deregistered host-side. So a workflow step can't read your token out of its
  own environment.
- **Network isolation** (Docker section) confines runners at the network layer:
  - `isolate` puts them on a dedicated bridge so they can't reach your **other
    Unraid containers**;
  - `strict` adds firewall rules (Docker's `DOCKER-USER` chain) that also block
    the runners from the **Unraid host and your LAN**, while still allowing the
    internet and the shared image cache. Recommended if runners might touch
    less-trusted code. Applies on the next Start; needs `iptables` on the host.
- For stronger isolation, set `EPHEMERAL=true` so each job gets a clean runner.
- At org scope, create a **runner group restricted to your private repos** so a
  public repo can never schedule onto these runners.

See GitHub's [self-hosted runner security guidance](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners#self-hosted-runner-security)
for the full picture.

---

## CLI

Everything in the UI maps to the control script:

```
include/runner-farm.sh {start|boot-autostart|stop|restart|scale N|status|status-json|logs i|validate|build-image|prune-cache|autoscale-*|list-profiles} [PROFILE]
```

---

## Multiple fleets (profiles)

The plugin can run more than one independent fleet — different repos, labels,
runner counts, caches, and Dockerfiles — side by side on the same box. See
[PROFILES.md](PROFILES.md) for how to switch between profiles in the UI, what
gets namespaced per profile, and the CLI form above. Existing single-fleet
installs are unaffected — that's the `default` profile.

---

## Releases & versioning

Releases are automated with
[release-please](https://github.com/googleapis/release-please) and published as
**GitHub Release assets** — the same flow used by Unraid's other plugins.

- `.release-please-manifest.json` is the SemVer source of truth; `VERSION`
  mirrors it for tooling.
- Merging [Conventional Commits](https://www.conventionalcommits.org) to `main`
  opens a release PR. That PR regenerates the self-contained
  `ci-runner-farm.plg` (version entities + embedded payload) and updates
  `CHANGELOG.md`.
- Merging the release PR tags `vX.Y.Z`, cuts a GitHub Release, validates the
  tagged `.plg`, and uploads it as the `ci-runner-farm.plg` release asset that
  the install URL above resolves to.

The Unraid plugin-manager `<version>` is written as
`YYYY.MM.DD.HHMM.BUILD-INTERNAL` (e.g. `2026.06.24.1530.42-0.1.0`) so it sorts
chronologically in the plugin manager while still pinning the SemVer release.

---

## Development

```sh
./build-plg.sh                 # build ci-runner-farm.plg from src/ (date-stamped dev build)
./deploy.sh root@tower         # rsync src/ to a dev Unraid host (fast iteration; not for installs)
```

The `.plg` uses the standard Unraid URL/MD5 `<FILE>` pattern: the plugin file
tree is tarred reproducibly into `ci-runner-farm.tgz`, and the committed `.plg`
pins that package's MD5. At install time Unraid downloads the package (or uses
a copy already on flash with a matching MD5 — see the private-repo install
above) and verifies it before extracting.

To verify the web UI without an Unraid box, `scripts/render-pages.php` stubs
the Dynamix runtime, renders every tab page in one process (mirroring how
Unraid renders all tabs in one request), and asserts field coverage, single
asset emission, and per-profile form targets:

```sh
php scripts/render-pages.php            # default profile
php scripts/render-pages.php myprofile  # any configured profile
```

### Layout

```
ci-runner-farm.plg                 installer (built artifact, committed; URL/MD5 pattern)
build-plg.sh                       packages src/ -> versioned .plg + .tgz
deploy.sh                          dev-only raw deploy to an Unraid host (not reboot-persistent)
scripts/render-pages.php           CLI render/assertion harness for the tab pages
scripts/publish-gcs.sh             build + publish to a public GCS bucket (private forks)
release-please-config.json         release-please configuration
.release-please-manifest.json      SemVer source of truth
VERSION                            mirror of the internal SemVer version
profiles/                          example fleet profiles (cfg + Dockerfile), see PROFILES.md
src/usr/local/emhttp/plugins/ci-runner-farm/
  RunnerFarm.page                  tabbed page container (xmenu parent)
  RunnerFarmOverview.page          tab: setup checklist, status, fleet control
  RunnerFarmGitHub.page            tab: GitHub scope/repos + PAT token
  RunnerFarmRunners.page           tab: sizing + autoscaling
  RunnerFarmImage.page             tab: image source/registry + Dockerfile builder
  RunnerFarmStorage.page           tab: caches + Docker/network
  runner-farm.js / runner-farm.css shared client assets (emitted once per request)
  default.cfg                      seed config
  default.Dockerfile               generic starter runner image
  include/page-common.php          shared PHP for the tab pages
  include/runner-farm.sh           provisioning/control script
  include/exec.php                 CSRF-guarded web endpoint
.github/workflows/
  package-plugins.yml              PR/branch build + validate
  release-please.yml               release automation + asset upload
  release.yml                      tagged-release validation
```

---

## Support

Questions and bug reports: <https://github.com/unraid/ci-runner-farm/issues>
