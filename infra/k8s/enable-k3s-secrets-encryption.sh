#!/usr/bin/env bash
set -euo pipefail

# Run during an approved maintenance window on the single K3s server.
if [[ "${KOBO_MAINTENANCE_CONFIRMED:-}" != "YES" ]]; then
  echo "Refus: définir KOBO_MAINTENANCE_CONFIRMED=YES pendant la fenêtre approuvée." >&2
  exit 2
fi

version="$(k3s --version | sed -n 's/^k3s version v\([^ ]*\).*/\1/p')"
required="1.34.6"
if [[ "$(printf '%s\n%s\n' "$required" "$version" | sort -V | head -n1)" != "$required" ]]; then
  echo "Refus: K3s $version détecté; mettre à niveau vers >= $required avant activation." >&2
  exit 3
fi

backup_dir="/home/ubuntu/security-backups/k3s-secrets-$(date -u +%Y%m%d-%H%M%S)"
sudo install -d -m 700 "$backup_dir"
sudo cp -a /etc/rancher/k3s/config.yaml "$backup_dir/config.yaml.before" 2>/dev/null || true
sudo k3s secrets-encrypt status | tee "$backup_dir/status.before"
sudo k3s secrets-encrypt enable

# The following restarts are intentional and must remain inside the window.
sudo systemctl restart k3s
until sudo k3s secrets-encrypt status | grep -q 'Current Rotation Stage: start'; do sleep 2; done
sudo k3s secrets-encrypt rotate-keys
sudo systemctl restart k3s
until sudo k3s secrets-encrypt status | grep -q 'Current Rotation Stage: reencrypt_finished'; do sleep 2; done
sudo k3s secrets-encrypt status | tee "$backup_dir/status.after"
echo "Chiffrement des Secrets K3s activé et ré-encodage terminé."
