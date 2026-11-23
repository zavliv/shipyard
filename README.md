# Shipyard

**A self-hosted control panel for your VPS.** Rent a virtual private server from any provider, run one command, and manage every website and API on it from your browser: deploy from GitHub, roll back, add domains with HTTPS, read logs, watch uptime, back up and restore. No SSH needed after setup.

Think of it as your own Vercel or Render, running on a server you control and pay for directly.

> **Early release.** The panel runs real sites in production, but the one-command installer is new and hasn't been tested on many servers yet. Use it on a **fresh** VPS, not one that already hosts sites, and please [open an issue](../../issues) if anything goes wrong.

## Who it's for

- Developers and small teams who host several sites or APIs on **one VPS** and are tired of doing it by hand over SSH.
- Anyone who wants Vercel-style deploys (push to GitHub, it goes live) without per-seat or per-site pricing.
- People who want to keep their apps on their own server, with no platform lock-in.

## What it does

- **Sites from GitHub.** Next.js, Node.js APIs, Python APIs (FastAPI, Flask) and static sites, from the top of a repository or a folder inside it.
- **Safe deploys.** Every deploy builds a new release next to the live one and only switches traffic once it answers. Websites switch with no downtime; APIs restart in about a second. A failed build never touches the live site.
- **Rollback** to any of the last five releases in one click.
- **Several apps per site.** Add a backend to a frontend from the same repository or another one, on a path like `/api` or on its own domain.
- **Domains and HTTPS.** Add or remove domains; free Let's Encrypt certificates are issued and renewed for you.
- **Auto-deploy on push**, per app, through a GitHub App webhook.
- **Settings per app.** Edit environment variables in the browser; secrets stay on the server.
- **Monitoring and alerts.** Uptime checks every minute, response time, memory and disk charts, and email alerts when a site goes down, crash-loops, the disk fills up, or a certificate is about to expire.
- **Backups.** Nightly backups of every site, kept 14 days, plus a verified backup before any site is deleted (kept 30 days). Restore in one click.
- **Jobs.** Every action runs as a job with live steps and logs. Waiting jobs can be cancelled, failed ones retried.
- **Email sign-in.** One admin, signed in with a code sent to their email. No passwords to leak.

## How it's different

- **No Docker, no Kubernetes.** Apps run directly on the server with nginx and pm2, the way most people already host Node and Python apps. Less memory used, nothing extra to learn, and you can still inspect everything over SSH.
- **One small VPS is enough.** The panel and its worker use about 200 MB of memory together, leaving the rest for your sites.
- **Your server, your data.** Code, settings and backups stay on your VPS. The only outside services are GitHub, your email provider and, if you choose it, MongoDB Atlas.

## Works with any VPS provider

Shipyard needs a plain Ubuntu server with root access, so it works with Hostinger, DigitalOcean, Hetzner, Vultr, Linode (Akamai), OVHcloud, AWS Lightsail, Google Cloud, Azure and others.

| Server size | Good for |
| --- | --- |
| 1 CPU, 2 GB memory | The panel plus a few small sites or APIs |
| 2 CPU, 4–8 GB memory | 10–20 sites, including Next.js apps that build on the server |
| More | Larger builds and busier sites |

Next.js builds are the heaviest part. If builds fail with out-of-memory errors, choose a larger plan or add a swap file.

## Requirements

- A VPS running **Ubuntu 22.04 or 24.04** (x86_64 or arm64), 2 GB of memory or more, with root access.
- A **domain** (or subdomain) for the panel, with an A record pointing to the VPS.
- **MongoDB**: a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster, or let the installer put MongoDB on the VPS.
- An **SMTP** account for sending sign-in codes and alerts (any provider, for example your domain's mailbox, Brevo, Mailgun or Amazon SES).
- A **GitHub** account.

## Before you install

1. **Create the VPS** with Ubuntu 24.04 and note its public IP address.
2. **Point a domain at it.** At your DNS provider, add an A record such as `panel.example.com → <your VPS IP>`. Tip: also add a wildcard record `*.example.com → <your VPS IP>`, so every site you add later works without touching DNS again.
3. **Open the web ports.** Many providers have their own firewall in their dashboard. Allow ports **80** and **443** there (and your SSH port), or HTTPS certificates can't be issued.
4. **If you use MongoDB Atlas**, add your VPS IP under *Network Access* in Atlas. Atlas blocks unknown IPs.

## Install

Connect to the VPS over SSH and run:

```bash
curl -fsSL https://raw.githubusercontent.com/zavliv/Shipyard/main/install.sh | sudo bash
```

The installer:

1. Checks the server and that your panel domain points to it.
2. Asks for the panel domain, your email, time zone, the database and SMTP settings, and whether to turn on the firewall.
3. Installs nginx, certbot, git, Python, uv, Node.js and pm2 (and MongoDB, if you chose the local option).
4. Creates the `apps` and `panel` users, the server helper `vpsctl`, and the settings file with freshly generated secrets.
5. Builds and starts the panel, then connects your domain with HTTPS.

It takes about 5 minutes. Every question can be answered ahead of time with environment variables (for example `PANEL_DOMAIN`, `ADMIN_EMAIL`, `MONGODB_URI`, `SMTP_HOST`) plus `NONINTERACTIVE=1`, for automated installs.

## First steps

1. Open `https://<your panel domain>` and sign in with the code emailed to you.
2. **Settings → Connect GitHub.** One click creates a private GitHub App for your panel; then choose which repositories it may see.
3. **Sites → Add site.** Pick a repository (and a folder, for monorepos), check the detected commands, enter a domain and any environment variables, review the plan, create.
4. Optional: turn on **auto-deploy** for the site, so every push to its branch goes live.

## Supported apps

| Type | Detected by | Default commands |
| --- | --- | --- |
| Next.js | `next` in `package.json` | `npm ci`, `npm run build`, `next start` |
| Node.js API | `package.json` with a start script | `npm ci`, `npm start` |
| Python API | `requirements.txt` or `pyproject.toml` | `uv sync` or `pip install`, then `uvicorn` (the FastAPI app is found automatically) |
| Static site | Vite, Create React App or Astro build, or plain HTML | build, then served by nginx |

Every command can be changed before creating the site. Repositories with several apps (for example `frontend/` and `backend/`) are supported: create the site from one folder, then add the other with **Apps → Add app**.

## How it works

```
browser ──► dashboard (Next.js) ──► job queue (MongoDB) ──► worker ──► vpsctl ──► nginx, pm2, files, certificates
```

- The **dashboard** shows pages and queues work. It never changes the server directly.
- The **worker** runs queued jobs one step at a time and checks site health every minute.
- **vpsctl** (`/usr/local/sbin/vpsctl`) is the only program that changes the server. The dashboard's user may run it as root and nothing else, every call is logged to `/var/log/vpsctl.log`, and each command checks its inputs.
- Sites run as their own user (`apps`) under pm2, each with a blue and a green slot so a new release can start before the old one stops. If the panel itself stops, your sites keep running.

On the server:

| Path | What |
| --- | --- |
| `/srv/apps/<site>/` | Each site: code, releases, settings, shared files, logs and an ownership record |
| `/srv/panel/shipyard/` | The panel itself |
| `/srv/backups/` | Nightly backups and backups of deleted sites |
| `/etc/nginx/sites-available/` | One file per site, plus small upstream files in `/etc/nginx/conf.d/` |

## Security

- Secrets live only in `/srv/panel/shipyard/web/.env` (readable only by the panel user) and in each site's own settings file. They are never stored in the database or written to logs; settings queued for a job are encrypted.
- Sign-in uses one-time email codes, with limits on failed attempts and on idle and total session time.
- Deleting a site needs its name typed and a second emailed code.
- The GitHub App has read-only access to code, and only to repositories you choose. Webhooks are verified with a signature.
- The installer can turn on the firewall (SSH, 80 and 443 only). It does not change your SSH settings; consider key-only SSH.

See [SECURITY.md](SECURITY.md) to report a problem.

## Settings

Set in `/srv/panel/shipyard/web/.env`. The installer fills these in.

| Setting | Meaning |
| --- | --- |
| `ADMIN_EMAIL` | Who can sign in |
| `MONGODB_URI`, `MONGODB_DB` | Database |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Email |
| `PANEL_URL` | The panel's address, used in email links and for GitHub |
| `UPDATE_REPO` | Repository that **Settings → Update** downloads from |
| `SERVER_IP` | Optional; detected automatically |
| `NEXT_PUBLIC_TIMEZONE`, `NEXT_PUBLIC_LOCALE` | How dates are shown and when the nightly backup runs (rebuild after changing) |
| `NEXT_PUBLIC_WILDCARD_DOMAIN` | Optional domain whose subdomains already point to the VPS, used in form hints |
| `HOSTINGER_API_TOKEN`, `HOSTINGER_VM_ID` | Optional weekly whole-server snapshots on Hostinger |

## Updating

**Settings → Update** downloads the latest version from `UPDATE_REPO`, builds it, and restarts the panel. Your sites keep running.

## Troubleshooting

| Problem | Check |
| --- | --- |
| The panel doesn't load | `sudo journalctl -u shipyard -n 50` |
| Deploys or backups don't run | `sudo journalctl -u shipyard-worker -n 50` |
| A server change failed | `sudo tail -n 50 /var/log/vpsctl.log` |
| A site is down | The site's **Logs** tab, or `sudo -u apps PM2_HOME=/home/apps/.pm2 /opt/node/current/bin/pm2 list` |
| nginx won't reload | `sudo nginx -t` |
| No sign-in email | SMTP settings in `.env`, and your provider's sending limits |
| HTTPS certificate fails | Ports 80 and 443 open in your provider's firewall, and the domain's A record points to the VPS |
| Builds run out of memory | A larger plan, or a swap file |

## FAQ

**Does it use Docker?** No. Apps run directly on the VPS with nginx and pm2.

**Can I install it on a VPS that already hosts sites?** Not recommended yet. The installer replaces nginx's default site and expects a clean server. Start with a fresh VPS and move sites over.

**Can it host databases?** Not as managed services. Use MongoDB Atlas or another hosted database, or install one on the VPS yourself and add its address to a site's settings.

**Does it support GitLab, Bitbucket, PHP or WordPress?** Not yet. GitHub and Node.js, Python and static sites only.

**Can several people sign in?** There's one admin account (the email set at install).

**What happens if the panel goes down?** Your sites keep running; they don't depend on the panel. Fix or restart the panel and nothing is lost.

**What does it cost?** Shipyard is free and open source. You pay only for your VPS and any outside services you choose.

## Uninstall

The panel can be removed without touching your sites, which keep running under pm2 and nginx:

```bash
sudo systemctl disable --now shipyard shipyard-worker
sudo rm -f /etc/systemd/system/shipyard.service /etc/systemd/system/shipyard-worker.service /etc/sudoers.d/91-panel-vpsctl /usr/local/sbin/vpsctl
sudo rm -f /etc/nginx/sites-enabled/<panel domain> /etc/nginx/sites-available/<panel domain>
sudo systemctl reload nginx
sudo rm -rf /srv/panel/shipyard
```

## License

[MIT](LICENSE)
