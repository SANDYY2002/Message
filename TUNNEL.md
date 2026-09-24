# Windows laptop with Cloudflare Tunnel

Use this instead of the public-server Compose file. Docker Desktop must be running with Linux containers. No router port forwarding or public IP is needed. The laptop must remain awake and online. Your existing root .env should contain APP_DOMAIN=chat.sandeshchhetri.info.np.

## Create the tunnel

In Cloudflare, open Networking → Tunnels (some accounts show this under Zero Trust → Networks → Connectors). Create a Cloudflared tunnel called message-laptop. Select Docker as the connector type. Copy only the token after --token in the displayed command. Do not run that separate Docker command; Compose below manages the connector.

Save the token as a single line in secrets/tunnel_token, with no quotes and no .txt extension. Use Notepad from PowerShell:

```powershell
cd E:\random\Message
git pull --ff-only origin main
notepad secrets\tunnel_token
```

The secrets directory is excluded from Git and image builds. Never share the token or paste it into chat. If exposed, rotate it in Cloudflare and recreate the tunnel container.

## Start

```powershell
docker compose -f compose.tunnel.yaml config --quiet
docker compose -f compose.tunnel.yaml up -d --build
docker compose -f compose.tunnel.yaml ps
docker compose -f compose.tunnel.yaml logs --tail=30 tunnel
```

If you previously started the public-server stack, stop it with docker compose down first, without -v. Both configurations intentionally reuse the same project name and data volumes. Do not run both stacks simultaneously. The Docker MySQL database is separate from a MySQL database previously used by npm run dev on Windows; old local accounts/media are not automatically imported.

Wait for the connector to show Healthy/Connected in Cloudflare, then add a Published application route:

| Field        | Value                  |
| ------------ | ---------------------- |
| Subdomain    | chat                   |
| Domain       | sandeshchhetri.info.np |
| Path         | Leave blank            |
| Service type | HTTP                   |
| Service URL  | gateway:8080           |

Use gateway:8080, not localhost:4000. HTTPS terminates at Cloudflare; traffic to the laptop travels through the encrypted tunnel. The internal gateway forwards the client IP for rate limiting and uses the app's existing secure cookies. No app, database, or gateway port is published to the host.

The tunnel route creates the DNS mapping. If a pre-existing chat A/AAAA/CNAME record conflicts, replace only that record after confirming it is unused. Do not change other domain records. Do not use the previous DNS-only A-record instructions for this tunnel setup. Keep Cloudflare's normal cache behavior; do not add Cache Everything for this app.

Open https://chat.sandeshchhetri.info.np and https://chat.sandeshchhetri.info.np/api/health. Test signup/login, messages and media from another device. Calls still require a separate TURN relay for reliable cross-network media; the web tunnel does not replace TURN.

## Updates and troubleshooting

Always use -f compose.tunnel.yaml with Docker Compose commands for this deployment. For updates, back up first, pull main, build, stop app, run --rm migrate, then up -d. In Git Bash/WSL you can select this file for the existing backup scripts using COMPOSE_FILE=compose.tunnel.yaml. For restore, the script's final public proxy startup is not applicable: follow the restore steps manually with this Compose file and start app gateway tunnel instead of app proxy.

For a 502 error, check app/gateway logs and confirm the route is HTTP gateway:8080. For a disconnected tunnel, check Docker Desktop, laptop sleep and tunnel logs. Some networks block outbound tunnel traffic; consult Cloudflare connectivity troubleshooting. Do not delete volumes to troubleshoot. Laptop hosting has no availability guarantee; maintain off-device backups.

Sources: https://developers.cloudflare.com/tunnel/get-started/ and https://developers.cloudflare.com/tunnel/reference/run-parameters/.
