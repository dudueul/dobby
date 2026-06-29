#!/usr/bin/env bash
# LUKS2-encrypt the surveillance disk and mount it at /srv/dobby/media.
# Usage: sudo ./provisioning/setup-storage.sh /dev/sdX
# WARNING: erases the target disk.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "run with sudo" >&2; exit 1; fi
DISK="${1:?usage: setup-storage.sh /dev/sdX}"
NAME="dobby_media"
MOUNT="/srv/dobby/media"
KEYFILE="/root/.dobby_media.key"

echo "Target: $DISK"
lsblk "$DISK"
read -rp "This ERASES $DISK. Type the disk name to confirm: " confirm
[[ "$confirm" == "$DISK" ]] || { echo "aborted"; exit 1; }

echo "==> generating keyfile for unattended unlock at boot"
if [[ ! -f "$KEYFILE" ]]; then
  dd if=/dev/urandom of="$KEYFILE" bs=4096 count=1
  chmod 0400 "$KEYFILE"
fi

echo "==> LUKS2 format + open"
cryptsetup luksFormat --type luks2 --batch-mode "$DISK" "$KEYFILE"
cryptsetup luksAddKey "$DISK" "$KEYFILE" --key-file "$KEYFILE"  # ensure key slot
cryptsetup open "$DISK" "$NAME" --key-file "$KEYFILE"

echo "==> ext4 + mount"
mkfs.ext4 -L dobby_media "/dev/mapper/$NAME"
mkdir -p "$MOUNT"
mount "/dev/mapper/$NAME" "$MOUNT"
mkdir -p "$MOUNT/frigate"
chown -R "${SUDO_USER:-dobby}":"${SUDO_USER:-dobby}" "$MOUNT"

echo "==> persist crypttab + fstab"
UUID="$(blkid -s UUID -o value "$DISK")"
grep -q "$NAME" /etc/crypttab 2>/dev/null || \
  echo "$NAME UUID=$UUID $KEYFILE luks" >> /etc/crypttab
grep -q "$MOUNT" /etc/fstab 2>/dev/null || \
  echo "/dev/mapper/$NAME $MOUNT ext4 defaults,nofail 0 2" >> /etc/fstab

echo "==> done. Encrypted surveillance disk mounted at $MOUNT"
echo "    Keep $KEYFILE safe; it lives on the (ideally FDE) OS NVMe."
