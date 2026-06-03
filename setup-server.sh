#!/bin/bash
# Run this as root on a fresh Hetzner Ubuntu 22.04 server
# Usage: bash setup-server.sh yourdomain.com

DOMAIN=${1:-""}
REPO="https://github.com/mawstr001/ameliachanwebsite.git"

set -e

echo "==> Updating system..."
apt update && apt upgrade -y

echo "==> Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs nginx git ufw

echo "==> Installing PM2..."
npm install -g pm2

echo "==> Creating deploy user..."
useradd -m -s /bin/bash deploy || true
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys 2>/dev/null || true
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

echo "==> Creating persistent data directory..."
mkdir -p /opt/data/uploads /opt/data/backups
chown -R deploy:deploy /opt/data

echo "==> Cloning repo..."
sudo -u deploy git clone $REPO /home/deploy/app

echo "==> Installing dependencies..."
cd /home/deploy/app && sudo -u deploy npm install --omit=dev

echo "==> Starting app with PM2..."
sudo -u deploy pm2 start /home/deploy/app/ecosystem.config.js
sudo -u deploy pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy
systemctl enable pm2-deploy

echo "==> Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> Configuring Nginx..."
cat > /etc/nginx/sites-available/amelia-chan << 'NGINX'
server {
    listen 80;
    server_name _;

    client_max_body_size 15M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/amelia-chan /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo ""
echo "===================================================="
echo " Done! Site is running at http://$(curl -s ifconfig.me)"
echo "===================================================="

if [ -n "$DOMAIN" ]; then
  echo ""
  echo "==> Setting up SSL for $DOMAIN..."
  apt install -y certbot python3-certbot-nginx
  sed -i "s/server_name _;/server_name $DOMAIN www.$DOMAIN;/" /etc/nginx/sites-available/amelia-chan
  nginx -t && systemctl reload nginx
  certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos -m admin@$DOMAIN
  echo " SSL active — site running at https://$DOMAIN"
fi

echo ""
echo "NEXT: Set your admin password in ecosystem.config.js then run:"
echo "  pm2 restart amelia-chan"
