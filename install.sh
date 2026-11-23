#!/usr/bin/env bash
# Installs the panel on a fresh Ubuntu 22.04/24.04 server.
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/install.sh | sudo bash
# Every answer can be given ahead of time as an environment variable (see ask calls below);
# set NONINTERACTIVE=1 to fail instead of prompting.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/zavliv/shipyard.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
NODE_VERSION="${NODE_VERSION:-v24.14.1}"
PANEL_PORT=3900
PANEL_DIR=/srv/panel/shipyard
WEB_DIR=$PANEL_DIR/web
ENV_FILE=$WEB_DIR/.env

bold=$'\e[1m'; dim=$'\e[2m'; red=$'\e[31m'; green=$'\e[32m'; reset=$'\e[0m'
step() { printf '\n%s==> %s%s\n' "$bold" "$*" "$reset"; }
ok() { printf '%s  ✓ %s%s\n' "$green" "$*" "$reset"; }
die() { printf '%s  ✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }

ask() {
  local var=$1 prompt=$2 default=${3:-} secret=${4:-} value=${!1:-}
  if [ -z "$value" ]; then
    [ "${NONINTERACTIVE:-}" = 1 ] && { [ -n "$default" ] && value=$default || die "$var is required"; }
    while [ -z "$value" ]; do
      if [ "$secret" = secret ]; then
        read -rsp "  $prompt: " value </dev/tty; echo
      else
        read -rp "  $prompt${default:+ [$default]}: " value </dev/tty
      fi
      value=${value:-$default}
    done
  fi
  printf -v "$var" '%s' "$value"
}

confirm() {
  local var=$1 prompt=$2 default=${3:-n} value=${!1:-}
  if [ -z "$value" ]; then
    if [ "${NONINTERACTIVE:-}" = 1 ]; then value=$default; else
      read -rp "  $prompt [$([ "$default" = y ] && echo Y/n || echo y/N)]: " value </dev/tty
      value=${value:-$default}
    fi
  fi
  case "$value" in [Yy]*) printf -v "$var" y ;; *) printf -v "$var" n ;; esac
}

[ "$(id -u)" = 0 ] || die "Run as root, for example: curl -fsSL … | sudo bash"
. /etc/os-release
[ "$ID" = ubuntu ] || die "Ubuntu is required (found $PRETTY_NAME)"
case "$VERSION_ID" in 22.04|24.04) ;; *) die "Ubuntu 22.04 or 24.04 is required (found $VERSION_ID)" ;; esac
[ "$(uname -m)" = x86_64 ] || [ "$(uname -m)" = aarch64 ] || die "x86_64 or arm64 is required"
[ -e "$PANEL_DIR" ] && [ "${REINSTALL:-}" != 1 ] && die "$PANEL_DIR already exists. This server already has the panel; use Update in its Settings."

SERVER_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p')
SSH_PORT=$( (sshd -T 2>/dev/null | awk '/^port /{print $2; exit}') || true)
SSH_PORT=${SSH_PORT:-22}
DEFAULT_TZ=$(timedatectl show -p Timezone --value 2>/dev/null || echo UTC)

step "A few questions"
echo "  ${dim}This server: $PRETTY_NAME, IP ${SERVER_IP:-unknown}, SSH port $SSH_PORT${reset}"
ask PANEL_DOMAIN "Domain for the panel (its A record must point to ${SERVER_IP:-this server})"
ask ADMIN_EMAIL "Your email (you sign in with codes sent here)"
ask TIMEZONE "Time zone for dates and the nightly backup" "$DEFAULT_TZ"
ask WILDCARD_DOMAIN "Optional: a domain whose *.subdomains point here (Enter to skip)" "-"
[ "$WILDCARD_DOMAIN" = - ] && WILDCARD_DOMAIN=""
echo
echo "  Database: paste a MongoDB Atlas connection string, or type 'local' to install MongoDB on this server."
ask MONGODB_URI "MongoDB connection string or 'local'" "local"
echo
echo "  Email for sign-in codes and alerts (any SMTP provider)."
ask SMTP_HOST "SMTP host"
ask SMTP_PORT "SMTP port" "465"
ask SMTP_USER "SMTP user"
ask SMTP_PASS "SMTP password" "" secret
ask MAIL_FROM "From address" "$SMTP_USER"
echo
confirm SETUP_FIREWALL "Turn on the firewall (allow only SSH port $SSH_PORT, 80 and 443)?" y

PANEL_DOMAIN=${PANEL_DOMAIN,,}; ADMIN_EMAIL=${ADMIN_EMAIL,,}
[[ "$PANEL_DOMAIN" =~ ^([a-z0-9-]+\.)+[a-z]{2,}$ ]] || die "Not a valid domain: $PANEL_DOMAIN"
[[ "$ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "Not a valid email: $ADMIN_EMAIL"
[ -e "/usr/share/zoneinfo/$TIMEZONE" ] || die "Unknown time zone: $TIMEZONE"
resolved=$(getent ahostsv4 "$PANEL_DOMAIN" | awk '{print $1; exit}' || true)
[ -z "$SERVER_IP" ] || [ "$resolved" = "$SERVER_IP" ] || die "$PANEL_DOMAIN points to ${resolved:-nothing}, not $SERVER_IP. Add an A record, wait a few minutes, then run again."

step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q >/dev/null
apt-get install -y -q nginx certbot python3-certbot-nginx git curl rsync ca-certificates python3 python3-venv build-essential ufw >/dev/null
if ! command -v uv >/dev/null; then
  curl -fsSL https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh >/dev/null
fi
ok "nginx, certbot, git, Python and uv"

step "Installing Node.js $NODE_VERSION and pm2"
arch=$([ "$(uname -m)" = aarch64 ] && echo arm64 || echo x64)
if [ ! -x "/opt/node/$NODE_VERSION/bin/node" ]; then
  install -d -m 755 /opt/node
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$arch.tar.xz" | tar -xJ -C /opt/node
  mv "/opt/node/node-$NODE_VERSION-linux-$arch" "/opt/node/$NODE_VERSION"
  chown -R root:root "/opt/node/$NODE_VERSION"
fi
ln -sfn "$NODE_VERSION" /opt/node/current
export PATH=/opt/node/current/bin:$PATH
[ -x /opt/node/current/bin/pm2 ] || npm install -g --silent pm2 >/dev/null
ok "node $(node -v), pm2 $(pm2 -v 2>/dev/null | tail -1)"

if [ "$MONGODB_URI" = local ]; then
  step "Installing MongoDB on this server"
  if ! command -v mongod >/dev/null; then
    codename=$VERSION_CODENAME
    curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
    echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu $codename/mongodb-org/8.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-8.0.list
    apt-get update -q >/dev/null
    apt-get install -y -q mongodb-org >/dev/null
  fi
  sed -i 's/^\(\s*bindIp:\).*/\1 127.0.0.1/' /etc/mongod.conf
  systemctl enable --now mongod >/dev/null 2>&1
  MONGODB_URI="mongodb://127.0.0.1:27017"
  ok "MongoDB running on 127.0.0.1 only (not reachable from outside)"
fi

step "Creating users and folders"
for u in apps panel; do
  id "$u" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$u" --shell /usr/sbin/nologin "$u"
done
chmod 750 /home/apps /home/panel
install -d -o root -g root -m 755 /srv/apps /var/www/shipyard
install -d -o root -g root -m 700 /srv/backups
install -d -o panel -g panel -m 750 /srv/panel
ok "user apps runs your sites, user panel runs the dashboard"

step "Setting up the process manager for your sites"
cat > /etc/systemd/system/pm2-apps.service <<'UNIT'
[Unit]
Description=PM2 process manager for /srv/apps (user apps)
After=network.target

[Service]
Type=forking
User=apps
LimitNOFILE=infinity
Environment=PATH=/opt/node/current/bin:/usr/local/bin:/usr/bin:/bin
Environment=PM2_HOME=/home/apps/.pm2
PIDFile=/home/apps/.pm2/pm2.pid
Restart=on-failure
ExecStart=/opt/node/current/lib/node_modules/pm2/bin/pm2 resurrect
ExecReload=/opt/node/current/lib/node_modules/pm2/bin/pm2 reload all
ExecStop=/opt/node/current/lib/node_modules/pm2/bin/pm2 kill

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now pm2-apps.service >/dev/null 2>&1
runuser -u apps -- env PATH=/opt/node/current/bin:/usr/bin:/bin PM2_HOME=/home/apps/.pm2 HOME=/home/apps pm2 save --force >/dev/null
ok "pm2 starts your sites on boot"

step "Downloading the panel"
if [ ! -d "$PANEL_DIR/.git" ]; then
  runuser -u panel -- git clone -q --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$PANEL_DIR"
fi
ok "$(runuser -u panel -- git -C "$PANEL_DIR" log -1 --format='%h %s')"

step "Installing the server helper (vpsctl)"
install -o root -g root -m 755 "$PANEL_DIR/server/vpsctl.py" /usr/local/sbin/vpsctl
install -o root -g root -m 600 /dev/null /var/log/vpsctl.log
TMP=$(mktemp)
echo 'panel ALL=(root) NOPASSWD: /usr/local/sbin/vpsctl' > "$TMP"
visudo -cf "$TMP" >/dev/null
install -o root -g root -m 440 "$TMP" /etc/sudoers.d/91-panel-vpsctl
rm -f "$TMP"
ok "the dashboard may run vpsctl as root, and nothing else"

step "Writing settings"
repo_path=$(printf '%s' "$REPO_URL" | sed -E 's#^https://github.com/##; s#\.git$##')
umask 077
cat > "$ENV_FILE" <<ENV
MONGODB_URI=$MONGODB_URI
MONGODB_DB=shipyard
VPSCTL_MODE=local
ADMIN_EMAIL=$ADMIN_EMAIL
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
MAIL_FROM=$MAIL_FROM
SHIPYARD_SECRET=$(openssl rand -base64 32)
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_PRIVATE_KEY_PATH=/srv/panel/github-app.pem
GITHUB_WEBHOOK_SECRET=
HOSTINGER_API_TOKEN=
HOSTINGER_VM_ID=
PANEL_URL=https://$PANEL_DOMAIN
UPDATE_REPO=$repo_path
SERVER_IP=$SERVER_IP
NEXT_PUBLIC_TIMEZONE=$TIMEZONE
NEXT_PUBLIC_LOCALE=en-GB
NEXT_PUBLIC_WILDCARD_DOMAIN=$WILDCARD_DOMAIN
ENV
umask 022
chown panel:panel "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "$ENV_FILE (readable only by the panel user)"

step "Building the panel (takes 2–4 minutes)"
runuser -u panel -- env PATH=/opt/node/current/bin:/usr/bin:/bin HOME=/home/panel npm --prefix "$WEB_DIR" ci --include=dev --no-audit --no-fund --loglevel=error >/dev/null
runuser -u panel -- env PATH=/opt/node/current/bin:/usr/bin:/bin HOME=/home/panel NODE_ENV=production npm --prefix "$WEB_DIR" run build >/tmp/panel-build.log 2>&1 || { tail -20 /tmp/panel-build.log; die "Build failed (full log: /tmp/panel-build.log)"; }
rm -f /tmp/panel-build.log
ok "built"

step "Starting the panel"
install -m 644 "$PANEL_DIR/server/shipyard.service" /etc/systemd/system/shipyard.service
install -m 644 "$PANEL_DIR/server/shipyard-worker.service" /etc/systemd/system/shipyard-worker.service
systemctl daemon-reload
systemctl enable --now shipyard.service shipyard-worker.service >/dev/null 2>&1
for _ in $(seq 1 30); do curl -fs -o /dev/null "http://127.0.0.1:$PANEL_PORT/login" && break; sleep 2; done
curl -fs -o /dev/null "http://127.0.0.1:$PANEL_PORT/login" || die "The panel didn't start. Check: journalctl -u shipyard -n 50"
ok "dashboard and background worker running"

step "Connecting $PANEL_DOMAIN with HTTPS"
grep -q worker_shutdown_timeout /etc/nginx/nginx.conf || sed -i 's/^\(\s*worker_processes.*;\)\s*$/\1\nworker_shutdown_timeout 30s;/' /etc/nginx/nginx.conf
sed "s/__PANEL_DOMAIN__/$PANEL_DOMAIN/g; s/__PANEL_PORT__/$PANEL_PORT/g" "$PANEL_DIR/server/panel.nginx.conf" > "/etc/nginx/sites-available/$PANEL_DOMAIN"
ln -sfn "/etc/nginx/sites-available/$PANEL_DOMAIN" "/etc/nginx/sites-enabled/$PANEL_DOMAIN"
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || die "nginx rejected the config: $(nginx -t 2>&1 | tail -2)"
systemctl reload nginx
certbot --nginx --non-interactive --agree-tos -m "$ADMIN_EMAIL" --redirect -d "$PANEL_DOMAIN" >/dev/null 2>&1 || die "Couldn't get an SSL certificate for $PANEL_DOMAIN. Check that ports 80 and 443 are open in your provider's firewall, then run: certbot --nginx -d $PANEL_DOMAIN"
ok "https://$PANEL_DOMAIN"

if [ "$SETUP_FIREWALL" = y ]; then
  step "Turning on the firewall"
  ufw allow "$SSH_PORT/tcp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  ok "open: $SSH_PORT (SSH), 80, 443"
fi

printf '\n%s%sDone.%s\n\n' "$bold" "$green" "$reset"
echo "  1. Open https://$PANEL_DOMAIN and sign in with $ADMIN_EMAIL (a code is emailed to you)."
echo "  2. Go to Settings → Connect GitHub. One click creates the GitHub App the panel uses."
echo "  3. Add your first site from a GitHub repository."
echo
echo "  ${dim}Your SSH settings were not changed. Consider key-only SSH if you haven't set it up.${reset}"
