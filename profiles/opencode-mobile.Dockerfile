# ci-runner-farm runner image for the "opencode-mobile" profile.
# Same base as default.Dockerfile (DinD readiness wait + health probe), plus a
# custom ENTRYPOINT that seeds a persistent Android SDK volume on first boot
# so `gradle`/`android` tooling in the workflow finds a warm SDK instead of
# re-provisioning it every job. Paste this into the Runner image builder for
# the opencode-mobile profile (or save as
# /boot/config/plugins/ci-runner-farm/opencode-mobile.Dockerfile), then Build.
FROM myoung34/github-runner:latest

USER root
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends unzip openjdk-17-jdk-headless \
 && rm -rf /var/lib/apt/lists/*

# Mounted from this profile's android-sdk cache (CACHE_MOUNTS); seeded once by
# entrypoint-wrapper.sh below, then reused warm across runs/jobs.
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=${ANDROID_SDK_ROOT}
ENV PATH="${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${PATH}"
RUN mkdir -p "${ANDROID_SDK_ROOT}"

# DinD: the base entrypoint starts dockerd (START_DOCKER_SERVICE=true) but does
# NOT wait for it to be ready. wait-docker.sh (below, same as default.Dockerfile)
# waits for it before the runner accepts jobs — otherwise 'Checking docker
# version'/services: race a cold daemon.
RUN printf '%s\n' \
  '#!/usr/bin/env bash' \
  '# supervise dockerd: it can die under the services: workload (nested overlay)' \
  '( while true; do docker info >/dev/null 2>&1 || { rm -f /var/run/docker.pid; service docker start >>/var/log/dockerd.log 2>&1; }; sleep 3; done ) &' \
  '# wait for first readiness before the runner accepts jobs' \
  'for i in $(seq 1 90); do docker info >/dev/null 2>&1 && break; sleep 1; done' \
  'exec "$@"' \
  > /usr/local/bin/wait-docker.sh \
 && chmod +x /usr/local/bin/wait-docker.sh

# Entrypoint wrapper: seed the Android SDK cmdline-tools + platform onto the
# (empty, first-boot) android-sdk cache volume, then hand off to wait-docker.sh
# and the runner listener. A warm volume (every boot after the first) skips
# straight past the seeding check. Best-effort: a failed download logs a
# warning and still starts the runner — the workflow's own setup step can
# install the SDK instead if this one couldn't reach google.com.
#
# Deliberately NOT set as the image's ENTRYPOINT: the base image's own
# ENTRYPOINT does the actual runner registration/config (using RUNNER_TOKEN
# etc.) and then execs CMD — same as default.Dockerfile, which never touches
# ENTRYPOINT either. This wrapper instead becomes CMD[0] below, so the layering
# stays: base ENTRYPOINT (registration) -> entrypoint-wrapper.sh (seed SDK) ->
# wait-docker.sh (wait for DinD) -> the real Runner.Listener command.
RUN printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -uo pipefail' \
  'SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/android-sdk}"' \
  'CMDLINE_VER="11076708"' \
  'if [ ! -d "$SDK_ROOT/cmdline-tools/latest" ]; then' \
  '  echo "[entrypoint-wrapper] seeding Android SDK at $SDK_ROOT (first boot on this volume)..."' \
  '  mkdir -p "$SDK_ROOT/cmdline-tools"' \
  '  tmp="$(mktemp -d)"' \
  '  if curl -fsSL -o "$tmp/cmdline-tools.zip" "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_VER}_latest.zip"; then' \
  '    unzip -q "$tmp/cmdline-tools.zip" -d "$tmp"' \
  '    mv "$tmp/cmdline-tools" "$SDK_ROOT/cmdline-tools/latest"' \
  '    yes | "$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK_ROOT" --licenses >/dev/null 2>&1 || true' \
  '    "$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK_ROOT" "platform-tools" "platforms;android-34" "build-tools;34.0.0" >/dev/null 2>&1 || true' \
  '  else' \
  '    echo "[entrypoint-wrapper] WARNING: could not download the Android cmdline-tools — install it in the workflow, or seed the android-sdk cache manually" >&2' \
  '  fi' \
  '  rm -rf "$tmp"' \
  'fi' \
  'exec "$@"' \
  > /usr/local/bin/entrypoint-wrapper.sh \
 && chmod +x /usr/local/bin/entrypoint-wrapper.sh

# Same health probe as default.Dockerfile: reap a runner whose GitHub
# registration was removed (its listener loops forever instead of exiting).
RUN printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -uo pipefail' \
  'pgrep -x Runner.Worker >/dev/null 2>&1 && exit 0' \
  'pgrep -x Runner.Listener >/dev/null 2>&1 || exit 1' \
  'log="$(ls -1t /actions-runner/_diag/Runner_*.log 2>/dev/null | head -1)"' \
  '[ -n "$log" ] || exit 0' \
  'last="$(grep -niE "Session created|Listening for Jobs|create session|connect error|Registration.*not found|has been removed|SessionConflict|SessionExpired|Retrying until reconnected|Runner listener exit" "$log" 2>/dev/null | tail -1)"' \
  'case "$last" in' \
  '  *"Session created"*|*"Listening for Jobs"*) exit 0 ;;' \
  '  "") exit 0 ;;' \
  '  *) exit 1 ;;' \
  'esac' \
  > /usr/local/bin/runner-healthcheck.sh \
 && chmod +x /usr/local/bin/runner-healthcheck.sh
HEALTHCHECK --start-period=120s --interval=30s --timeout=10s --retries=3 \
  CMD ["/usr/local/bin/runner-healthcheck.sh"]

CMD ["/usr/local/bin/entrypoint-wrapper.sh", "/usr/local/bin/wait-docker.sh", "./bin/Runner.Listener", "run", "--startuptype", "service"]
