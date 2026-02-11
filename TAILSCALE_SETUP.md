# Tailscale Setup for Control UI

## What Changed

- Container now starts Tailscale daemon on boot
- Control UI accessible via Tailscale network instead of insecure HTTP
- Gateway config already has `tailscale.mode: "serve"`

## Setup Steps

### 1. Generate Tailscale Pre-Auth Token

1. Go to https://login.tailscale.com/admin/settings/keys
2. Click **Generate auth key**
3. Settings:
   - **Reusable**: No (single-use preferred for security)
   - **Expiration**: 30 days or more
   - **Tags**: (optional, for network policies)
4. Copy the token (it will disappear after you leave the page)

### 2. Add TAILSCALE_AUTH_KEY to Railway

1. Go to your Railway project dashboard
2. Select the **OpenClaw** service
3. Go to **Variables** tab
4. Add new variable:
   - **Name**: `TAILSCALE_AUTH_KEY`
   - **Value**: Paste the token from step 1
5. **Deploy** the service with the new variable

### 3. Deploy feature/tailscale-integration

Merge the PR or redeploy the feature branch to apply the code changes:
```bash
git merge origin/feature/tailscale-integration
git push origin main
```

### 4. Verify Tailscale is Running

After deployment, check the logs:
```
[tailscale] Starting Tailscale daemon...
[tailscale] Bringing up Tailscale with auth key...
[tailscale] Status:
[tailscale] ✓ Tailscale initialized successfully
```

### 5. Access Control UI

Once Tailscale is active on the container:
- On your mobile with Tailscale running, visit:
  ```
  http://<container-tailnet-ip>:18789
  ```
- Find the IP in Railway logs or via `tailscale status` on the container

## Security Notes

- **allowInsecureAuth: true** can now be disabled in gateway config (optional)
  ```bash
  openclaw config set gateway.controlUi.allowInsecureAuth false
  ```
- Control UI is now only accessible via Tailscale peer network
- The pre-auth token is consumed on first boot; regenerate for future deployments

## Troubleshooting

**Tailscale won't start:**
- Check `TAILSCALE_AUTH_KEY` is set in Railway Variables
- Verify token hasn't expired
- Check container logs for auth errors

**Can't reach Control UI:**
- Verify both devices are on the same Tailscale network
- Check Tailscale is running: `tailscale status` (if you have shell access)
- Try pinging the container's Tailnet IP from your mobile

**Port conflict:**
- Control UI is still on 18789 (internal gateway port)
- Wrapper HTTP server is on 8080 (healthcheck)
