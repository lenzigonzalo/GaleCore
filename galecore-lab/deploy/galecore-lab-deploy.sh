#!/usr/bin/env bash
# Pasos remotos del despliegue del Lab (WS-0088 F3). Lo llama .github/workflows/deploy.yml.
#
# Se instala una vez en el VPS, como root (ver install.sh):
#   sudo install -o root -g root -m 755 galecore-lab-deploy.sh /usr/local/bin/galecore-lab-deploy
# y se invoca SIN argumentos:  sudo /usr/local/bin/galecore-lab-deploy
# El tarball tiene ruta fija (lo sube scp al home de galecore-deploy): la regla de sudoers no
# acepta argumentos para que el NOPASSWD no sirva para extraer como root cualquier otro archivo.
#
# El tarball ya viene sin node_modules ni tests: los paquetes se instalan aca con npm ci.
set -euo pipefail

LAB_DIR=/srv/galecore/lab
TARBALL=/home/galecore-deploy/galecore-lab.tar.gz
INSTANCES=(elenzi glenzi)

if [[ $# -ne 0 ]]; then
  echo "FALLO: galecore-lab-deploy no recibe argumentos (despliega $TARBALL)" >&2
  exit 2
fi
if [[ ! -f "$TARBALL" ]]; then
  echo "FALLO: no existe $TARBALL (subilo con scp antes)" >&2
  exit 2
fi

# El Lab persiste su estado en /home/<user>/.galecore/lab-state (fuera de $LAB_DIR): el extract
# nunca pisa chats ni sesiones de los traders.
# Rollback: guardamos $LAB_DIR.prev con el codigo anterior y restauramos si cualquier paso del
# deploy falla antes del try-restart. Asi si npm ci rompe, los labs no quedan con codigo inconsistente
# cuando la proxima vez reinicien (crash, reboot).
BACKUP_DIR="$LAB_DIR.prev"
rollback() {
  echo "FALLO a mitad del deploy; restaurando $LAB_DIR desde $BACKUP_DIR" >&2
  rm -rf "$LAB_DIR"
  if [[ -d "$BACKUP_DIR" ]]; then mv "$BACKUP_DIR" "$LAB_DIR"; fi
}
trap rollback ERR

install -d -o galecore -g galecore -m 755 "$LAB_DIR"
# Guardar codigo anterior (sin node_modules para ahorrar espacio/tiempo; se reinstala con npm ci).
rm -rf "$BACKUP_DIR"
if [[ -n "$(ls -A "$LAB_DIR" 2>/dev/null)" ]]; then
  mkdir -p "$BACKUP_DIR"
  find "$LAB_DIR" -mindepth 1 -maxdepth 1 -not -name node_modules -not -name .npm \
       -exec mv -t "$BACKUP_DIR" {} +
fi

echo "==> Extrayendo tarball a $LAB_DIR"
tar -xzf "$TARBALL" -C "$LAB_DIR" --no-same-owner
chown -R galecore:galecore "$LAB_DIR"

echo "==> npm ci --omit=dev"
# npm necesita HOME escribible; el service user galecore no tiene /home/galecore creado.
sudo -u galecore env HOME="$LAB_DIR" npm_config_cache="$LAB_DIR/.npm" \
     bash -c "cd '$LAB_DIR' && npm ci --omit=dev"

# Exito: ya no hay que restaurar; limpiar el backup antes del restart.
trap - ERR
rm -rf "$BACKUP_DIR"

# Si el unit file del repo cambio, aplicarlo antes del restart. El install.sh ya lo instala en
# la primera vuelta; aca lo refrescamos por si evoluciono con el deploy.
if [[ -f "$LAB_DIR/deploy/galecore-lab@.service" ]]; then
  echo "==> Actualizando unit de systemd si cambio"
  if ! cmp -s "$LAB_DIR/deploy/galecore-lab@.service" /etc/systemd/system/galecore-lab@.service; then
    install -o root -g root -m 644 "$LAB_DIR/deploy/galecore-lab@.service" /etc/systemd/system/galecore-lab@.service
    systemctl daemon-reload
  fi
fi

echo "==> Reiniciando instancias"
for instance in "${INSTANCES[@]}"; do
  if systemctl is-enabled --quiet "galecore-lab@${instance}.service"; then
    systemctl try-restart "galecore-lab@${instance}.service"
    echo "    reiniciado galecore-lab@${instance}"
  else
    echo "    saltado galecore-lab@${instance} (no habilitado)"
  fi
done

echo "==> OK"
