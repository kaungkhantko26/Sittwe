# Cross-network room relay setup

Status: client and credential proxy are ready. A live TURN account and deployed proxy are still required. GitHub Pages cannot execute this proxy itself.

1. Complete the [Metered Open Relay signup](https://dashboard.metered.ca/signup?tool=turnserver) yourself, including password and provider terms. Use the free service if its current allowance meets your needs; do not enable paid billing without deciding to do so.
2. Create a TURN credential in the dashboard. Keep the **credential-scoped** API key private; do not use a management/secret key in browser code or commit it.
3. Use a Cloudflare Workers account. From this folder run `npx wrangler login` and complete sign-in yourself. Add `METERED_DOMAIN = "your-app.metered.live"` under `[vars]` in `wrangler.toml`.
4. Run `npx wrangler secret put TURN_CREDENTIAL_API_KEY` and paste the credential-scoped key into that local prompt. Deploy with `npx wrangler deploy`. Set usage limits/alerts and rate limits for the public credential endpoint in your hosting/provider dashboards. Browser Origin filtering is not authentication against non-browser clients.
5. In `public/multiplayer.json`, set `iceServersUrl` to `https://YOUR-WORKER.workers.dev/ice`. Leave `relayOnly: false` for automatic direct/TURN selection. The endpoint must return an ICE server array or `{ "iceServers": [...] }`, with UDP plus TCP/TLS routes provided by your TURN service.
6. Publish the site. On both friends' devices open Rooms → Test relay. Both should report a successful relay allocation.
7. Temporarily set `relayOnly: true`, publish, and join the same room from two devices on **different** Wi-Fi/mobile networks. Move and verify updates in both directions; this proves a relayed data connection, whereas an allocation test alone does not. Restore `relayOnly: false` after testing.

A 60-second stale-peer grace period and a timer independent of rendering reduce premature disconnects. Mobile browsers can still suspend background tabs; keep the host in the foreground while playing. No camera or microphone is requested.

References: [WebRTC TURN](https://webrtc.org/getting-started/turn-server), [PeerJS configuration](https://peerjs.com/client/api/peer), [Metered credentials endpoint](https://www.metered.ca/docs/turn-rest-api/get-credential/).
