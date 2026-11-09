# Deploying a Worker Node on a Linux Host

This guide installs `oasm-worker` directly on a Linux host (not in Docker Compose) as a background systemd service. It runs in **node mode** as an unprivileged `scanner` user. It was written against Ubuntu 24.04. Other systemd distributions work the same way, but they may not need step 5.

For the Compose deployment, use `task docker-compose` and the `oasm-worker` service in `docker-compose.yml` instead.

## Why node mode

Core-api only gives connector jobs (image-based tools such as `nmap`, `nuclei`) to workers that joined with `runMode = node`. A worker in `cli` mode receives only built-in jobs that carry a `command`, such as `screenshot`. If a `cli` worker is the only worker in a workspace, its connector jobs stay `pending`. The filter is in `getNextJob` in `core-api/src/modules/jobs-registry/jobs-registry.service.ts`.

The binary defaults to `cli` mode (the interactive TUI). That is what `install.sh --run` starts. A server deployment must pass `--mode node`.

## Why a dedicated non-root user

Running the worker as an ordinary user keeps Chromium's sandbox working. go-rod adds `--no-sandbox` only when it detects a container, so a worker run as **root** on a bare host fails every screenshot and agent-browser launch:

```
browser launch failed: ... Running as root without --no-sandbox is not supported.
```

## Prerequisites

- A Linux host with systemd that can reach core-api's gRPC port (default `16276`).
- Docker Engine installed and running. Node mode spawns connector containers through the Docker socket.
- A worker join key from the console. Treat it as a secret. Never pass it on a command line, where it lands in shell history and `ps`.

Check connectivity from the host first:

```bash
getent hosts <core-api-host>
timeout 5 bash -c '</dev/tcp/<core-api-host>/16276' && echo open
```

If Docker is missing:

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

## Install

Run every step as root on the worker host.

### 1. Create the user

```bash
useradd -m -s /bin/bash -c "OASM scanner worker" scanner
usermod -aG docker scanner
```

`scanner` gets no sudo. Membership of the `docker` group is equivalent to root on this host. That is inherent to node mode, so run only trusted connector images.

### 2. Install the binary

Download `oasm-worker-linux-<arch>` from the [GitHub releases](https://github.com/oasm-platform/open-asm/releases), then install it root-owned so that `scanner` cannot replace it:

```bash
install -d -o root -g root -m 755 /opt/oasm-worker
install -o root -g root -m 755 oasm-worker-linux-amd64 /opt/oasm-worker/oasm-worker
```

### 3. Write the configuration

Read the key without echoing it, then write the file readable only by root and `scanner`:

```bash
read -rs WORKER_API_KEY
install -d -o root -g scanner -m 750 /etc/oasm-worker
umask 027
cat > /etc/oasm-worker/worker.env <<EOF
WORKER_API_KEY=${WORKER_API_KEY}
WORKER_GRPC_HOST=<core-api-host>
WORKER_GRPC_PORT=16276
WORKER_TLS_ENABLED=false
# 0 = auto-size from the CPU/RAM available to the worker
WORKER_MAX_CONCURRENCY=0
# Required in node mode outside a container: the address connector containers
# dial back to. The worker adds the host-gateway mapping itself on Linux.
WORKER_CONNECTOR_ADDR=host.docker.internal:26276
EOF
chown root:scanner /etc/oasm-worker/worker.env
chmod 640 /etc/oasm-worker/worker.env
umask 022
unset WORKER_API_KEY
```

| Variable | Notes |
|---|---|
| `WORKER_API_KEY` | Join key from the console. |
| `WORKER_GRPC_HOST` / `WORKER_GRPC_PORT` | core-api gRPC endpoint. |
| `WORKER_TLS_ENABLED` | `true` when core-api's gRPC is behind TLS (e.g. port 443 behind a proxy). |
| `WORKER_MAX_CONCURRENCY` | `0` auto-sizes; set a number to cap it. |
| `WORKER_CONNECTOR_ADDR` | **Required.** If it is missing, the worker still joins but disables its container engine (see Troubleshooting). Do not use `0.0.0.0`. |

The worker also reads `WORKER_NETWORK` (internal network id) and `WORKER_CONNECTOR_TLS_CERT` / `_KEY` / `_CA` (mTLS for the connector callback). The callback is plaintext by default, which the startup log warns about.

### 4. Create the systemd unit

```bash
cat > /etc/systemd/system/oasm-worker.service <<'EOF'
[Unit]
Description=OASM worker node (scanner)
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=simple
User=scanner
Group=scanner
SupplementaryGroups=docker
WorkingDirectory=/home/scanner
Environment=HOME=/home/scanner
EnvironmentFile=/etc/oasm-worker/worker.env
ExecStart=/opt/oasm-worker/oasm-worker --mode node
Restart=always
RestartSec=10
TimeoutStopSec=60
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
```

The worker keeps its state in `/home/scanner/.oasm/`: the join token `.worker-token`, the tool cache `oasm-tools/` and agent sessions. go-rod downloads Chromium (~530 MB) into `/home/scanner/.cache/rod/` on first use. Deleting `.worker-token` makes the worker join as a new worker.

### 5. Allow Chromium's sandbox (Ubuntu 23.10+)

Ubuntu sets `kernel.apparmor_restrict_unprivileged_userns=1`, which stops a non-root Chromium from creating its sandbox (`No usable sandbox`). Check it:

```bash
sysctl kernel.apparmor_restrict_unprivileged_userns
```

If it prints `1`, allow user namespaces for go-rod's Chromium in `scanner`'s home only. Ubuntu's own Chrome profile does the same:

```bash
cat > /etc/apparmor.d/oasm-chromium <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile oasm-chromium /home/scanner/.cache/rod/browser/*/chrome flags=(unconfined) {
  userns,
  include if exists <local/oasm-chromium>
}
EOF
apparmor_parser -r /etc/apparmor.d/oasm-chromium
```

If a system Chromium is installed at `/usr/bin/chromium`, `/usr/bin/chromium-browser` or `/usr/bin/google-chrome`, the worker prefers it. Usually the distribution's own profile already covers that binary.

### 6. Firewall

Connector containers dial the worker on port `26276` over the Docker bridge. If a host firewall is active, allow that port from the bridge subnet:

```bash
ufw allow from 172.17.0.0/16 to any port 26276 proto tcp
```

### 7. Start

```bash
systemctl daemon-reload
systemctl enable --now oasm-worker
```

## Verify

```bash
systemctl status oasm-worker
journalctl -u oasm-worker -f
```

A healthy start logs, in order:

```
success [System] connector server listening on [::]:26276
success [System] execution manager ready (Docker runtime, ...)
success [System] joined, worker_id=<uuid>
```

Then confirm:

- The console lists the worker as online, in **node** mode.
- `docker ps` shows `oasm-<tool>-…` containers while connector jobs run. Idle containers are removed after 60 s, so an empty list between jobs is normal.
- `aa-status | grep oasm-chromium` lists Chromium processes once a screenshot job runs.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Worker is online but connector jobs stay `pending` | Worker joined in `cli` mode | Start it with `--mode node` |
| Jobs fail instantly with `container engine unavailable on this worker` | Startup log shows `WORKER_CONNECTOR_ADDR is required` | Set `WORKER_CONNECTOR_ADDR`, then `systemctl restart oasm-worker` |
| `container engine unavailable`; startup log shows a Docker socket `permission denied` | User is not in the socket's group | `usermod -aG docker scanner`; keep `SupplementaryGroups=docker` in the unit |
| Connector jobs hang, then time out | Containers cannot reach `:26276` | Open the firewall (step 6); check the `WORKER_CONNECTOR_ADDR` value |
| Screenshot: `Running as root without --no-sandbox is not supported` | Worker runs as root on a bare host | Run as `scanner` (this guide) |
| Screenshot: `No usable sandbox` | AppArmor userns restriction | Step 5 |
| `join failed` / `worker stream ended` just after core-api restarts | core-api still booting | Transient; the worker retries on its own |

Jobs that failed before a fix are not retried automatically. Re-run them from the console.

## Operating

- **Change config or rotate the key:** edit `/etc/oasm-worker/worker.env`, then run `systemctl restart oasm-worker`. Running `systemctl enable --now` again does not restart a running service.
- **Upgrade:** install the new binary over `/opt/oasm-worker/oasm-worker`, then `systemctl restart oasm-worker`. Jobs running when the service stops are interrupted (they log `context canceled`) and are picked up again after the restart.
- **Uninstall:**

  ```bash
  systemctl disable --now oasm-worker
  apparmor_parser -R /etc/apparmor.d/oasm-chromium
  rm -f /etc/systemd/system/oasm-worker.service /etc/apparmor.d/oasm-chromium
  systemctl daemon-reload
  rm -rf /opt/oasm-worker /etc/oasm-worker
  userdel -r scanner
  ```
