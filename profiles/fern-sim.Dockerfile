# ci-runner-farm runner image for the "fern-sim" profile.
# Flutter (stable) + Java 17 + Android SDK so the Unraid runner can analyze,
# test, and produce Android appbundles — same role as opencode-mobile's image
# for Expo/Android, but without Node/Go/Playwright.
#
# iOS archives still need a Mac; this image is Linux/Android only.
#
# Paste into Runner image builder for profile fern-sim, Save, Build.
# Tag: ci-runner-farm-runner-fern-sim:latest
FROM myoung34/github-runner:latest

USER root
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    git \
    unzip \
    zip \
    xz-utils \
    libglu1-mesa \
    clang \
    cmake \
    ninja-build \
    pkg-config \
    libgtk-3-dev \
 && rm -rf /var/lib/apt/lists/*

# Java 17 — Flutter Android toolchain
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk-headless && \
    java -version && \
    rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH=$PATH:$JAVA_HOME/bin

# Flutter stable (pinned channel; `flutter upgrade` on rebuild)
ENV FLUTTER_HOME=/opt/flutter
ENV FLUTTER_GIT_URL=https://github.com/flutter/flutter.git
RUN git clone --depth 1 -b stable "$FLUTTER_GIT_URL" "$FLUTTER_HOME" \
 && "$FLUTTER_HOME/bin/flutter" --disable-analytics \
 && "$FLUTTER_HOME/bin/flutter" config --no-analytics \
 && "$FLUTTER_HOME/bin/flutter" precache --android \
 && "$FLUTTER_HOME/bin/dart" --disable-analytics
ENV PATH=$PATH:$FLUTTER_HOME/bin:$FLUTTER_HOME/bin/cache/dart-sdk/bin

# Android SDK baked under builtin; entrypoint seeds the mounted ANDROID_HOME
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_BUILTIN=/opt/android-sdk-builtin
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

RUN mkdir -p ${ANDROID_SDK_BUILTIN}/cmdline-tools && \
    curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/cmdline-tools.zip && \
    unzip -q /tmp/cmdline-tools.zip -d /tmp/cmdline-tools && \
    mv /tmp/cmdline-tools/cmdline-tools ${ANDROID_SDK_BUILTIN}/cmdline-tools/latest && \
    rm -rf /tmp/cmdline-tools /tmp/cmdline-tools.zip && \
    (yes | ${ANDROID_SDK_BUILTIN}/cmdline-tools/latest/bin/sdkmanager --sdk_root=${ANDROID_SDK_BUILTIN} --licenses >/dev/null 2>&1 || true) && \
    ${ANDROID_SDK_BUILTIN}/cmdline-tools/latest/bin/sdkmanager --sdk_root=${ANDROID_SDK_BUILTIN} \
      "platform-tools" \
      "platforms;android-36" \
      "build-tools;36.0.0" \
      "cmdline-tools;latest" && \
    test -d ${ANDROID_SDK_BUILTIN}/platforms/android-36 && \
    yes | "$FLUTTER_HOME/bin/flutter" doctor --android-licenses >/dev/null 2>&1 || true

# Seed mounted ANDROID_HOME from builtin. Skip when platforms/android-36 already
# exists (do not re-copy — races on a shared volume used to kill the runner).
RUN printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -uo pipefail' \
  'ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"' \
  'ANDROID_SDK_BUILTIN="${ANDROID_SDK_BUILTIN:-/opt/android-sdk-builtin}"' \
  'MARKER="${ANDROID_HOME}/.crf-sdk-seeded"' \
  'LOCK="${ANDROID_HOME}/.crf-sdk-seed.lock"' \
  'mkdir -p "${ANDROID_HOME}"' \
  '(' \
  '  if command -v flock >/dev/null 2>&1; then flock 9; fi' \
  '  if [ -d "${ANDROID_HOME}/platforms/android-36" ]; then' \
  '    [ -f "$MARKER" ] || touch "$MARKER"' \
  '  elif [ ! -f "$MARKER" ]; then' \
  '    echo "Seeding Android SDK into ${ANDROID_HOME} from ${ANDROID_SDK_BUILTIN}..."' \
  '    cp -a "${ANDROID_SDK_BUILTIN}/." "${ANDROID_HOME}/"' \
  '    if [ -d "${ANDROID_HOME}/platforms/android-36" ]; then touch "$MARKER";' \
  '    else echo "WARNING: Android SDK seed incomplete at ${ANDROID_HOME}" >&2; fi' \
  '  fi' \
  ') 9>"$LOCK"' \
  'export ANDROID_HOME ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"' \
  'export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"' \
  'exec "$@"' \
  > /usr/local/bin/entrypoint-wrapper.sh \
 && chmod +x /usr/local/bin/entrypoint-wrapper.sh

RUN printf '%s\n' \
  '#!/usr/bin/env bash' \
  '( while true; do docker info >/dev/null 2>&1 || { rm -f /var/run/docker.pid; service docker start >>/var/log/dockerd.log 2>&1; }; sleep 3; done ) &' \
  'for i in $(seq 1 90); do docker info >/dev/null 2>&1 && break; sleep 1; done' \
  'exec "$@"' \
  > /usr/local/bin/wait-docker.sh \
 && chmod +x /usr/local/bin/wait-docker.sh

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
