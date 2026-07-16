# Fleet profiles (multi-fleet support)

CI Runner Farm can run more than one independent runner fleet on the same
Unraid box. Each fleet is a **profile**: its own GitHub target, runner count,
labels, cache mounts, Dockerfile, and (optionally) its own GitHub token.
Profiles run concurrently without colliding on container names, cache
directories, the shared image-pull mirror, or the isolated network.

The `default` profile is the original single-fleet behavior. It always
exists, can't be deleted, and needs **zero config changes** for existing
installs — everything below is additive.

## Using profiles from the web UI

Settings > Utilities > CI Runner Farm is a **fleet console** (wizard on first
run; **Fleet settings** drawer for cfg). A **Fleet profile** switcher sits in
the console top bar:

- Click a profile name to switch to that fleet (the page reloads with
  `?profile=NAME`). Console controls, the settings drawer, and the wizard all
  apply to the selected profile only.
- **+ Add profile** creates a new profile, seeded with a copy of the
  `default` profile's current settings, so you only need to change what's
  different (repo, labels, runner count, caches).
- **Delete this profile** removes a non-default profile's config, token, and
  Dockerfile. It's blocked while that profile's fleet is running — Stop it
  first.
- Start/Stop/Restart/Scale/Test host setup on the console always act on the
  profile you're currently viewing, and Fleet settings Apply writes to that
  profile's own config file.

## What's namespaced per profile

| Thing | `default` | other profiles |
|---|---|---|
| Config file | `ci-runner-farm.cfg` (unchanged) | `<profile>.cfg` |
| GitHub token | `token` (unchanged) | `<profile>.token`, falls back to `token` if not set |
| Dockerfile | `Dockerfile` (unchanged) | `<profile>.Dockerfile`, falls back to the plugin's `default.Dockerfile` |
| Built-in image tag | `ci-runner-farm-runner:latest` | `ci-runner-farm-runner-<profile>:latest` |
| Container names | `ci-runner-1`, `ci-runner-2`, ... | `ci-runner-<profile>-1`, `ci-runner-<profile>-2`, ... |
| Cache root | `CACHE_ROOT` as configured (unchanged) | `<CACHE_ROOT>/<profile>` (so cloned profiles sharing the same `CACHE_ROOT` never collide) |
| Shared image-pull mirror | `ci-runner-mirror` | `ci-runner-mirror-<profile>` |
| Isolated network | `ci-runner-net` | `ci-runner-net-<profile>` |
| Autoscale/image-update daemons, logs, PID files | unsuffixed (unchanged) | suffixed with `-<profile>` |

The registry login (`registry-token`, `REGISTRY_SERVER`/`REGISTRY_USERNAME`)
is host-wide and shared by every profile — it's a `docker login` on the
Unraid box, not something that can be namespaced per fleet.

All of this lives under `/boot/config/plugins/ci-runner-farm/`.

## Using profiles from the command line

Every `runner-farm.sh` subcommand takes an optional trailing `PROFILE`
argument (default: `default`):

```
runner-farm.sh start [PROFILE]
runner-farm.sh stop [PROFILE]
runner-farm.sh restart [PROFILE]
runner-farm.sh scale <N> [PROFILE]
runner-farm.sh status [PROFILE]
runner-farm.sh status-json [PROFILE]
runner-farm.sh logs <i> [n] [PROFILE]
runner-farm.sh validate [PROFILE]
runner-farm.sh build-image [PROFILE]
runner-farm.sh prune-cache [PROFILE]
runner-farm.sh list-profiles
```

`list-profiles` enumerates every configured profile (always including
`default`), one per line — it's what the install/boot/shutdown hooks use to
bring every fleet up or down together.

Profile names are validated as alphanumeric + hyphens, max 32 characters —
the same rule the web UI's `exec.php` enforces before it will shell out to
the script.

## Migration path for existing single-fleet installs

Nothing to do. An existing install's `ci-runner-farm.cfg`, `token`,
`Dockerfile`, and running `ci-runner-N` containers are exactly the
`default` profile — the web UI opens on the `default` tab and everything
behaves exactly as before. Add a profile only when you want a second,
independent fleet alongside it.

## Example: two profiles targeting different repos

This fork ships with two example profiles configured against
`dbrieck/ThisProp` and `dbrieck/opencode-mobile`:

- **`thisprop`** — repo-scoped to `dbrieck/ThisProp`, labels
  `self-hosted,linux,x64,thisprop`, 2 concurrent runners, warm caches for
  nuget/npm/the Firebase emulator suite.
- **`opencode-mobile`** — repo-scoped to `dbrieck/opencode-mobile`, labels
  `self-hosted,linux,x64,opencode-mobile`, 1 runner, warm caches for
  npm/Gradle/the Android SDK, and a custom Dockerfile entrypoint wrapper
  that seeds the Android SDK volume on first boot.

See `profiles/thisprop.cfg` and `profiles/opencode-mobile.cfg` (and
`profiles/opencode-mobile.Dockerfile`) in this repo for the exact settings —
copy them into `/boot/config/plugins/ci-runner-farm/` as `<profile>.cfg` /
`<profile>.Dockerfile`, or use **+ Add profile** in the UI and fill in the
same values, then set each profile's GitHub token and Start it.

## Out of scope

- Org-scope multi-fleet (all profiles are repo-scoped for now).
- Cross-profile shared cache mounts — each profile's caches are isolated by
  design (see the cache-root namespacing above).
- Per-profile autoscaling UI — autoscaling settings are inherited from the
  same global fields, just applied within each profile's own fleet.
