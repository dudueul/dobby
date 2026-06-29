#!/usr/bin/env bash
# Idempotent host bootstrap for the dobby hub on Ubuntu Server 24.04 LTS.
# Installs Docker + Compose, Intel media/compute runtimes, age/rclone/duckdb,
# the service user, the host firewall, and the sysctls the stack needs.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "run with sudo" >&2; exit 1; fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_USER="${SUDO_USER:-dobby}"

echo "==> apt base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release ufw \
  age rclone jq smartmontools nvme-cli vainfo \
  intel-media-va-driver-non-free intel-opencl-icd

echo "==> Docker Engine + Compose plugin"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> service user in docker group"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$SERVICE_USER"
usermod -aG docker,render,video "$SERVICE_USER"

echo "==> data/media roots"
mkdir -p /srv/dobby/data /srv/dobby/media/frigate /opt/dobby/secrets
chown -R "$SERVICE_USER":"$SERVICE_USER" /srv/dobby /opt/dobby/secrets
chmod 700 /opt/dobby/secrets

echo "==> sysctls (mosquitto/HA/Frigate friendliness)"
cat >/etc/sysctl.d/60-dobby.conf <<'SYS'
fs.inotify.max_user_watches=524288
fs.inotify.max_user_instances=512
vm.overcommit_memory=1
SYS
sysctl --system >/dev/null

echo "==> host firewall: default-deny inbound, allow SSH + WireGuard only"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'ssh'
ufw allow 51820/udp comment 'wireguard'
# Service UIs stay LAN-reachable via the router's VLAN rules, not via the host.
# To additionally pin them to the trusted VLAN, uncomment and set your subnet:
# for p in 8123 5000 3000 8080 8091 8095 1780; do
#   ufw allow from 10.0.10.0/24 to any port "$p" proto tcp; done
ufw --force enable
ufw status verbose

echo "==> done. Log out/in so '$SERVICE_USER' picks up the docker group."
echo "    next: sudo ./provisioning/setup-storage.sh /dev/sdX"
