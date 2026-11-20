#!/usr/bin/env bash
# Setup de una vez del Lab remoto en el VPS (WS-0088 F3). Idempotente: podes correrlo cuantas
# veces quieras; actualiza lo que haya cambiado y no toca estado de usuarios.
#
# Despues de esto, cada merge a main actualiza el codigo via deploy.yml (job `lab:`) y restartea
# las instancias habilitadas sin intervencion manual.
#
# Pide: root/sudo, Node.js 20+ ya instalado (ver docs/VPS-SETUP.md), nginx corriendo con el site
# galecore-datafeed activo, galecore-datafeed.service corriendo en 127.0.0.1:5001.
#
# Correr desde adentro del repo monorepo clonado, o con $LAB_SRC apuntando a galecore-lab/.
set -euo pipefail

LAB_SRC="${LAB_SRC:-$(cd "$(dirname "$0")/.." && pwd)}"
LAB_DIR=/srv/galecore/lab
NGINX_SITE=/etc/nginx/sites-enabled/galecore-datafeed
NGINX_SNIPPET=/etc/nginx/snippets/galecore-lab.conf

if [[ $EUID -ne 0 ]]; then
  echo "FALLO: install.sh corre como root (usa sudo)" >&2
  exit 2
fi
if [[ ! -f "$LAB_SRC/deploy/galecore-lab-deploy.sh" ]]; then
  echo "FALLO: LAB_SRC no es galecore-lab/ (no hay deploy/galecore-lab-deploy.sh en $LAB_SRC)" >&2
  exit 2
fi

echo "==> 1) Script de deploy remoto"
install -o root -g root -m 755 "$LAB_SRC/deploy/galecore-lab-deploy.sh" /usr/local/bin/galecore-lab-deploy

echo "==> 2) Sudoers para galecore-deploy (NOPASSWD, sin args)"
install -o root -g root -m 440 /dev/stdin /etc/sudoers.d/galecore-lab-deploy <<EOF
galecore-deploy ALL=(ALL) NOPASSWD: /usr/local/bin/galecore-lab-deploy ""
EOF
visudo -c -f /etc/sudoers.d/galecore-lab-deploy >/dev/null

echo "==> 3) Systemd unit template"
install -o root -g root -m 644 "$LAB_SRC/deploy/galecore-lab@.service" /etc/systemd/system/galecore-lab@.service
systemctl daemon-reload

echo "==> 4) Directorio /srv/galecore/lab (dueño galecore)"
install -d -o galecore -g galecore -m 755 "$LAB_DIR"

echo "==> 5) Symlink al harness (el Lab busca /srv/galecore/galecore-ai)"
if [[ ! -L /srv/galecore/galecore-ai && ! -e /srv/galecore/galecore-ai ]]; then
  ln -s /srv/galecore/ai/galecore-ai /srv/galecore/galecore-ai
fi

echo "==> 6) .scratch sticky (shared entre traders)"
install -d /srv/galecore/ai/galecore-ai/.scratch
chmod 1777 /srv/galecore/ai/galecore-ai/.scratch

echo "==> 7) Nginx snippet (F2 con auth_request) y backup del anterior"
if [[ -f "$NGINX_SNIPPET" ]] && ! cmp -s "$LAB_SRC/deploy/nginx-galecore-lab.conf" "$NGINX_SNIPPET"; then
  cp "$NGINX_SNIPPET" "$NGINX_SNIPPET.bak.$(date +%Y%m%d%H%M%S)"
fi
install -o root -g root -m 644 "$LAB_SRC/deploy/nginx-galecore-lab.conf" "$NGINX_SNIPPET"

echo "==> 8) Asegurar include en el site de nginx"
if ! grep -q 'include snippets/galecore-lab.conf;' "$NGINX_SITE"; then
  echo "AVISO: $NGINX_SITE no incluye snippets/galecore-lab.conf; agregalo a mano"
  echo "       (buscar donde esten los otros 'include snippets/...')"
fi

echo "==> 9) Validar y recargar nginx"
nginx -t
systemctl reload nginx

echo
echo "==> OK. Lo que sigue (una sola vez por trader):"
echo "    - Crear /etc/galecore-lab/<usuario>.env con 'GALECORE_LAB_PORT=<puerto>'"
echo "    - Asegurar /home/<usuario>/.galecore, .claude, .codex, .curlrc (ver work item)"
echo "    - sudo systemctl enable --now galecore-lab@<usuario>.service"
echo "    - Desde el trader: claude /login && codex login"
