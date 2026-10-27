# Sittwe VPS TURN relay

Deployed on the SSH alias `new-vps` (Ubuntu 24.04), public IPv4 `118.27.147.15`.
The game remains on GitHub Pages. PeerJS signaling remains unchanged; the room
creator still needs to keep their game open.

## Running services

- Coturn (`coturn.service`), realm and TLS name `mail.kiiidev.com`.
- UDP/TCP 3478, TLS over TCP 5349; UDP relay allocations 62000–62255.
- Shared signing secret: root-only `/etc/sittwe-relay/auth-secret` and Cloudflare
  Worker secret `TURN_SHARED_SECRET`. Never put either value in Git or client code.
- The existing `/ice` Worker issues unique six-hour HMAC credentials. Existing
  Metered configuration is retained as a rollback option but is not selected while
  `TURN_HOST` and `TURN_SHARED_SECRET` are configured.
- Coturn is capped at 128 total allocations, 32 per temporary username,
  128,000 bytes/sec per session and 4,000,000 bytes/sec aggregate.
- Private, loopback, link-local and multicast relay destinations are blocked.

`install.sh` is specific to this VPS and its existing Caddy certificate storage.
It installs Coturn, saves the original config, creates a signing secret, copies
only the mail hostname's TLS certificate, opens the four required firewall rules,
and enables service startup. It does not upgrade Ubuntu or change mail/Caddy ports.
The certificate refresh timer checks the Caddy-renewed certificate every six hours
and restarts Coturn only when it changes. Such a restart can interrupt relayed rooms.

## Operations

```sh
ssh new-vps 'sudo systemctl status coturn sittwe-relay-cert.timer'
ssh new-vps 'sudo journalctl -u coturn -n 50 --no-pager'
ssh new-vps 'sudo /usr/local/sbin/sittwe-relay-cert'
```

Transfer a newly rotated signing secret directly through a pipe to Wrangler;
never print it or pass it in command-line arguments. Both sides must match.

The credential endpoint is public because the game has no account login. Origin
checking is not user authentication. Coturn quotas bound concurrent usage, but a
public game can still consume VPS bandwidth. Monitor provider traffic usage.

Networks that block both 3478 and 5349 may still prevent relay access. Port 443
is already occupied by this VPS's web services; do not replace that listener.
A dedicated public IP or a separate relay host would allow TURN TLS on port 443.

To roll back to the retained Metered configuration, remove `TURN_HOST` from the
Worker vars and redeploy it. To stop only the VPS relay:

```sh
ssh new-vps 'sudo systemctl disable --now coturn sittwe-relay-cert.timer'
```

Disable the VPS relay only after switching the game to a working alternative.
