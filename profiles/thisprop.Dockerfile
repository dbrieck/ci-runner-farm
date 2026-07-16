# ci-runner-farm runner image for the "thisprop" profile.
# Ported from github-runner/Dockerfile (ThisProp: Node, Java, PowerShell, .NET,
# Firebase, Android/MAUI, eas-cli) plus DinD wait + healthcheck for the farm.
#
# Paste via Import (thisprop.export.json) or Runner image builder. Build tag:
# ci-runner-farm-runner-thisprop:latest
FROM myoung34/github-runner:latest

USER root
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl wget git unzip zip apt-transport-https \
 && rm -rf /var/lib/apt/lists/*

# Node 20 + npm via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    node --version && npm --version && \
    rm -rf /var/lib/apt/lists/*

# Java 21 (Firebase emulators / firebase-tools 15.x) + Java 17 (Android/javac)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-21-jre-headless openjdk-17-jdk-headless && \
    java -version && javac -version && \
    rm -rf /var/lib/apt/lists/*

# PowerShell via Microsoft feed
RUN wget -q https://packages.microsoft.com/config/ubuntu/20.04/packages-microsoft-prod.deb && \
    dpkg -i packages-microsoft-prod.deb && \
    apt-get update && \
    apt-get install -y --no-install-recommends powershell && \
    rm -f packages-microsoft-prod.deb && \
    pwsh --version && \
    rm -rf /var/lib/apt/lists/*

# .NET 10
RUN curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh && \
    chmod +x /tmp/dotnet-install.sh && \
    /tmp/dotnet-install.sh --version 10.0.301 --install-dir /usr/share/dotnet && \
    ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet && \
    rm /tmp/dotnet-install.sh && \
    dotnet --version
ENV DOTNET_ROOT=/usr/share/dotnet
ENV PATH=$PATH:/usr/share/dotnet

RUN npm install -g firebase-tools@15.20.0 eas-cli

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
      "build-tools;36.0.0" && \
    test -d ${ANDROID_SDK_BUILTIN}/platforms/android-36 && \
    ANDROID_HOME=${ANDROID_SDK_BUILTIN} ANDROID_SDK_ROOT=${ANDROID_SDK_BUILTIN} \
      dotnet workload install android

# Seed mounted ANDROID_HOME from builtin. Skip entirely when the SDK is already
# present (marker or platforms/android-36) — re-copying a partial tree with
# set -e used to kill runners on "File exists" races.
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
