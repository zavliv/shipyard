# Shipyard

A private control panel for your own Linux server. Connect GitHub, pick a repository, and Shipyard builds it, runs it, and puts it live on your domain with HTTPS. After that you deploy, roll back, read logs, back up and restore from the browser instead of SSH.

> Early release. It runs real sites in production, but expect rough edges. Back up anything important before installing on a server that already hosts sites.

## What it does

- **Sites from GitHub.** Next.js, Node.js APIs, Python (FastAPI, Flask) and static sites, from the top of a repository or a folder inside it.
- **Safe deploys.** Every deploy builds a new release next to the live one and only switches traffic once it answers. Websites switch with no downtime; APIs restart in about a second. A failed build never touches the live site.
- **Rollback** to any of the last five releases in one click.
- **Several apps per site.** Add a backend to a frontend, on a path like `/api` or on its own domain.
- **Domains and HTTPS.** Add or remove domains; certificates from Let's Encrypt renew on their own.
- **Auto-deploy on push**, per app, through a GitHub App webhook.
- **Monitoring and alerts.** Uptime checks every minute, response time, memory and disk charts, and email alerts when a site goes down, crash-loops, or a certificate is about to expire.
- **Backups.** Nightly backups of every site, kept 14 days, plus a verified backup before any site is deleted. Restore in one click.
- **Jobs.** Every action runs as a job with live steps and logs. Waiting jobs can be cancelled, failed ones retried.
- **Email sign-in.** One admin, signed in with a code sent to their email. No passwords to leak.

## Requirements

- A server running **Ubuntu 22.04 or 24.04** (x86_64 or arm64), 2 GB of memory or more, with root access.
- A **domain** (or subdomain) for the panel, with an A record pointing to the server.
- **MongoDB**: a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster, or let the installer put MongoDB on the server.
- An **SMTP** account for sending sign-in codes and alerts (any provider).
- A **GitHub** account.

## Install

On a fresh server:

```bash
curl -fsSL https://raw.githubusercontent.com/zavliv/shipyard/main/install.sh | sudo bash
```

The installer asks for the panel domain, your email, the database and SMTP settings, then sets everything up. It takes about 5 minutes. When it's done:

1. Open `https://<your panel domain>` and sign in with the code emailed to you.
2. Go to **Settings → Connect GitHub**. One click creates a private GitHub App for your panel; then choose which repositories it may see.
3. **Sites → Add site**, pick a repository, review the plan, create.

Every question can be answered ahead of time with environment variables (for example `PANEL_DOMAIN`, `ADMIN_EMAIL`, `MONGODB_URI`, `SMTP_HOST`) and `NONINTERACTIVE=1`, for automated installs.

## How it works

```
browser ──► dashboard (Next.js) ──► job queue (MongoDB) ──► worker ──► vpsctl ──► nginx, pm2, files, certificates
```

- The **dashboard** shows pages and queues work. It never changes the server directly.
- The **worker** runs queued jobs one step at a time and checks site health every minute.
- **vpsctl** (`/usr/local/sbin/vpsctl`) is the only program that changes the server. The dashboard's user may run it as root and nothing else, every call is logged to `/var/log/vpsctl.log`, and each command checks its inputs.
- Sites run as their own user (`apps`) under pm2, each with a blue and a green slot so a new release can start before the old one stops.

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
- The GitHub App has read-only access to code and only to repositories you choose.
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
| `NEXT_PUBLIC_WILDCARD_DOMAIN` | Optional domain whose subdomains already point to the server, used in form hints |
| `HOSTINGER_API_TOKEN`, `HOSTINGER_VM_ID` | Optional weekly server snapshots on Hostinger |

## Updating

**Settings → Update** downloads the latest version from `UPDATE_REPO`, builds it, and restarts the panel. Your sites keep running.

## License

[MIT](LICENSE)
