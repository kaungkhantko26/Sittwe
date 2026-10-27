#!/bin/bash
# Run as root on the authorized Ubuntu VPS. No secret is printed.
set -euo pipefail
CERT_DIR=/var/lib/docker/volumes/n8n_caddy_data/_data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/mail.kiiidev.com
if ! test -s "$CERT_DIR/mail.kiiidev.com.crt" || ! test -s "$CERT_DIR/mail.kiiidev.com.key"; then
  echo 'Existing TLS certificate is missing'; exit 1
fi
if ! command -v turnserver >/dev/null; then
  systemctl mask coturn.service
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends coturn
fi
install -d -m 750 -o root -g turnserver /etc/sittwe-relay
if ! test -s /etc/sittwe-relay/auth-secret; then
  umask 077
  openssl rand -hex 32 > /etc/sittwe-relay/auth-secret
fi
if ! test -e /etc/sittwe-relay/turnserver.conf.before-sittwe; then
  cp -a /etc/turnserver.conf /etc/sittwe-relay/turnserver.conf.before-sittwe
fi
python3 - <<'PY'
from pathlib import Path
secret=Path('/etc/sittwe-relay/auth-secret').read_text().strip()
config='''listening-port=3478
tls-listening-port=5349
listening-ip=118.27.147.15
relay-ip=118.27.147.15
realm=mail.kiiidev.com
server-name=mail.kiiidev.com
fingerprint
use-auth-secret
static-auth-secret=SECRET
cert=/etc/sittwe-relay/tls.crt
pkey=/etc/sittwe-relay/tls.key
min-port=62000
max-port=62255
user-quota=32
total-quota=128
max-bps=128000
bps-capacity=4000000
relay-threads=1
no-cli
no-tcp-relay
no-multicast-peers
no-dtls
no-tlsv1
no-tlsv1_1
stale-nonce=600
no-software-attribute
syslog
simple-log
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
'''.replace('SECRET',secret)
Path('/etc/turnserver.conf').write_text(config)
PY
chown root:turnserver /etc/turnserver.conf
chmod 640 /etc/turnserver.conf
cat > /usr/local/sbin/sittwe-relay-cert <<'SCRIPT'
#!/bin/bash
set -euo pipefail
source_dir=/var/lib/docker/volumes/n8n_caddy_data/_data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/mail.kiiidev.com
if ! cmp -s "$source_dir/mail.kiiidev.com.crt" /etc/sittwe-relay/tls.crt; then
  install -m 640 -o root -g turnserver "$source_dir/mail.kiiidev.com.crt" /etc/sittwe-relay/tls.crt
  install -m 640 -o root -g turnserver "$source_dir/mail.kiiidev.com.key" /etc/sittwe-relay/tls.key
  systemctl try-restart coturn.service
fi
SCRIPT
chmod 750 /usr/local/sbin/sittwe-relay-cert
/usr/local/sbin/sittwe-relay-cert
cat > /etc/systemd/system/sittwe-relay-cert.service <<'UNIT'
[Unit]
Description=Refresh Sittwe TURN certificate from the existing renewed certificate
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/sittwe-relay-cert
UNIT
cat > /etc/systemd/system/sittwe-relay-cert.timer <<'UNIT'
[Unit]
Description=Refresh Sittwe TURN TLS certificate every six hours
[Timer]
OnBootSec=10min
OnUnitActiveSec=6h
Persistent=true
[Install]
WantedBy=timers.target
UNIT
ufw allow 3478/tcp comment 'Sittwe TURN TCP'
ufw allow 3478/udp comment 'Sittwe TURN UDP'
ufw allow 5349/tcp comment 'Sittwe TURN TLS'
ufw allow 62000:62255/udp comment 'Sittwe TURN relay allocations'
systemctl unmask coturn.service
systemctl daemon-reload
systemctl enable --now coturn.service sittwe-relay-cert.timer
systemctl is-active coturn.service
