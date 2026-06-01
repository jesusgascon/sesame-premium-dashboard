#!/bin/bash
# ============================================================
#  start.sh — Lanzador de Sesame Premium Dashboard
#  Uso: ./start.sh          → inicia accesible desde la red local
#       ./start.sh local    → inicia solo en este equipo
#       ./start.sh token    → primero extrae el token
# ============================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

show_options() {
  echo "Sesame Premium Dashboard - Arranque"
  echo "-----------------------------------"
  echo "  ./start.sh        LAN por defecto"
  echo "  ./start.sh lan    LAN explicito"
  echo "  ./start.sh local  Solo este equipo"
  echo "  ./start.sh token  Extraer credenciales"
  echo
}

show_options

case "$1" in
  token|credentials|login)
    echo "Extrayendo credenciales de Sesame HR..."
    python3 get-token.py
    ;;
  lan|network|red)
    echo "Iniciando en modo LAN..."
    echo "Acceso: red local + contraseña maestra."
    SESAME_HOST="${SESAME_HOST:-0.0.0.0}" SESAME_LAN=1 python3 server.py
    ;;
  local|localhost|loopback)
    echo "Iniciando solo en este equipo..."
    SESAME_HOST="${SESAME_HOST:-127.0.0.1}" python3 server.py
    ;;
  help|-h|--help)
    ;;
  *)
    echo "Iniciando en modo LAN..."
    echo "Acceso: red local + contraseña maestra."
    SESAME_HOST="${SESAME_HOST:-0.0.0.0}" SESAME_LAN=1 python3 server.py
    ;;
esac
