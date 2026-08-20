#!/usr/bin/env bash
# Take a blank Ubuntu server to a running study. Idempotent -- safe to run twice.
#
#   curl -fsSL https://raw.githubusercontent.com/<user>/<repo>/dev/deploy/setup.sh | bash -s -- <domain>
# or, having cloned already:
#   bash deploy/setup.sh maze.example.cn
#
# Leave the domain off to run on the IP over plain http. Good for a reachability test
# from inside China, since a raw IP needs no ICP filing. NOT for the real study: the
# page works, but participant data crosses the network unencrypted, which is an ethics
# and data-protection problem. (The questionnaire itself is fine -- an http page may
# embed an https iframe; browsers only block the reverse.)
set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-https://github.com/scriptsherlock/llm-maze-prototype.git}"
BRANCH="${BRANCH:-dev}"
APP_DIR="${APP_DIR:-$HOME/llm-maze-prototype}"
SITE_CODE="${SITE_CODE:-cn}"

echo "==> node"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node --version

echo "==> app"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --all && git -C "$APP_DIR" checkout "$BRANCH" && git -C "$APP_DIR" pull
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm install --omit=dev

# No KV_REST_API_* on purpose: without them the app keeps its data in
# error_logs/store.json on this machine's own disk, so nothing crosses the border.
cat > .env <<ENVEOF
PORT=3000
SITE_CODE=$SITE_CODE
ENVEOF

echo "==> service"
sudo npm install -g pm2 >/dev/null 2>&1 || true
# ONE instance. The JSON store is read-modify-write, which is safe because Node handles
# one request at a time per process; two processes on one file can interleave and lose
# rows. Never -i max here.
pm2 delete maze >/dev/null 2>&1 || true
pm2 start server.js --name maze
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null

echo "==> https"
if [ -n "$DOMAIN" ]; then
  if ! command -v caddy >/dev/null 2>&1; then
    sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    sudo apt-get update && sudo apt-get install -y caddy
  fi
  # Caddy gets and renews the certificate itself; nothing to configure.
  echo "$DOMAIN {
  reverse_proxy localhost:3000
}" | sudo tee /etc/caddy/Caddyfile >/dev/null
  sudo systemctl restart caddy
  URL="https://$DOMAIN"
else
  URL="http://$(curl -s ifconfig.me):3000"
  echo "!! no domain given -- http only, the questionnaire will not load. Smoke test only."
fi

echo
echo "done: $URL"
echo "  health   $URL/api/run-log?health=1     expect \"ok\":true and \"backend\":\"file\""
echo "  study    $URL/study/participant?condition=disappear"
echo "  data     $URL/api/run-log?export=summaries"
echo
echo "Back up $APP_DIR/error_logs/store.json -- on this setup it is the whole study."
