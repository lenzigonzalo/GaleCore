#!/usr/bin/env bash
# Pasos remotos del despliegue de la API (WS-0081). Una sola forma de desplegar: los llaman
# deploy-api.ps1 (a mano) y .github/workflows/deploy.yml (al mergear a main).
#
# Se instala una vez en el VPS, como root (ver "Configuracion de una vez" en WS-0081):
#   sudo install -o root -g root -m 755 remote-deploy.sh /usr/local/bin/galecore-deploy
# y se invoca SIN argumentos:  sudo /usr/local/bin/galecore-deploy
# El tarball tiene ruta fija (lo sube scp al home de elenzi): la regla de sudoers no acepta argumentos,
# asi el NOPASSWD no sirve para extraer como root cualquier otro archivo.
#
# El tarball ya viene sin los archivos de estado de runtime (Files/*_switch_state.json,
# skew25_history.json): extraer encima solo pisa lo que viaja, nunca esos.
set -euo pipefail

APP_DIR=/srv/galecore/app
SERVICE=galecore-datafeed
TARBALL=/home/elenzi/galecore-publish.tar.gz

if [[ $# -ne 0 ]]; then
  echo "FALLO: galecore-deploy no recibe argumentos (despliega $TARBALL)" >&2
  exit 2
fi
if [[ ! -f "$TARBALL" ]]; then
  echo "FALLO: no existe $TARBALL (subilo con scp antes)" >&2
  exit 2
fi

# Defensa en profundidad: si un archivo de estado se colo, el deploy pisaria los switches del operador.
if tar -tzf "$TARBALL" | grep -E 'switch_state\.json|skew25_history\.json'; then
  echo "FALLO: el tarball trae archivos de estado de runtime (arriba). No se despliega." >&2
  exit 3
fi

stopped=0
# Si algo falla despues de parar el servicio, no dejar la API abajo: volver a arrancarla.
trap 'if [[ $stopped -eq 1 ]]; then echo "FALLO a mitad del deploy: intentando arrancar $SERVICE" >&2; systemctl start "$SERVICE" || true; fi' ERR

echo "==> Parando $SERVICE"
systemctl stop "$SERVICE"
stopped=1

echo "==> Extrayendo en $APP_DIR"
tar -xzf "$TARBALL" -C "$APP_DIR"
chown -R galecore:galecore "$APP_DIR"

echo "==> Arrancando $SERVICE"
systemctl start "$SERVICE"
stopped=0

rm -f "$TARBALL"

echo "==> Estado"
systemctl is-active "$SERVICE"
ls -l "$APP_DIR/Files/Gex/gex_switch_state.json" "$APP_DIR/Files/skew25_history.json" || true
echo "Deploy remoto OK."
