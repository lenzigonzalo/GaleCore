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
AI_DIR=/srv/galecore/ai/galecore-ai
AI_TARBALL=/home/galecore-deploy/galecore-ai.tar.gz   # opcional: sin él, el harness queda como está

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
# BF-0020: carpeta del semáforo de tareas y de la marca del chat (GALECORE_TASKS_SLOTS_DIR), común a todos los usuarios.
install -d -m 755 /var/lib/galecore
install -d -m 777 /var/lib/galecore/tasks-slots
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

# Harness Python (WS-0106): el Lab, el supervisor y `task serve` corren /srv/galecore/ai/galecore-ai, instalado
# con `pip install -e` en el venv. src/ y tools/ se reemplazan enteros (no quedan modulos borrados); lo demas se
# pisa archivo por archivo, sin borrar lo que el VPS tenga de mas (.scratch compartido, configuracion local).
# pip sólo si cambió pyproject.toml. Si algo falla, vuelve la copia anterior y el Lab sigue con el harness viejo.
if [[ -f "$AI_TARBALL" ]]; then
  echo "==> Actualizando galecore-ai en $AI_DIR"
  AI_BACKUP="$AI_DIR.prev.tar.gz"
  tar -czf "$AI_BACKUP" -C "$AI_DIR" --exclude=./.scratch .
  deps_changed=1
  if tar -xzOf "$AI_TARBALL" pyproject.toml | cmp -s - "$AI_DIR/pyproject.toml"; then deps_changed=0; fi
  ai_rollback() {
    echo "FALLO actualizando galecore-ai; restaurando la copia anterior" >&2
    rm -rf "$AI_DIR/src" "$AI_DIR/tools"
    tar -xzf "$AI_BACKUP" -C "$AI_DIR"
  }
  trap ai_rollback ERR
  rm -rf "$AI_DIR/src" "$AI_DIR/tools"
  tar -xzf "$AI_TARBALL" -C "$AI_DIR" --no-same-owner
  chown -R galecore:galecore "$AI_DIR"
  chmod 1777 "$AI_DIR/.scratch" 2>/dev/null || true
  if [[ $deps_changed -eq 1 ]]; then
    echo "==> pyproject.toml cambió: pip install -e"
    sudo -u galecore env HOME=/srv/galecore/ai /srv/galecore/ai/venv/bin/pip install -q -e "$AI_DIR"
  fi
  (cd /tmp && sudo -u galecore /srv/galecore/ai/venv/bin/python -B -c "import galecore_ai.adapters.cli")
  trap - ERR
  rm -f "$AI_BACKUP" "$AI_TARBALL"
fi

# El propio script de deploy: si el repo trae otra versión, queda instalada para el próximo deploy.
if [[ -f "$LAB_DIR/deploy/galecore-lab-deploy.sh" ]] && ! cmp -s "$LAB_DIR/deploy/galecore-lab-deploy.sh" /usr/local/bin/galecore-lab-deploy; then
  echo "==> Actualizando /usr/local/bin/galecore-lab-deploy"
  install -o root -g root -m 755 "$LAB_DIR/deploy/galecore-lab-deploy.sh" /usr/local/bin/galecore-lab-deploy
fi

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
