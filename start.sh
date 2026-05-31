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
  echo "Sesame Premium Dashboard — opciones de arranque"
  echo "  ./start.sh          Modo red local (por defecto)"
  echo "  ./start.sh lan      Modo red local"
  echo "  ./start.sh local    Solo este equipo"
  echo "  ./start.sh token    Extraer credenciales"
  echo
}

show_options

case "$1" in
  token|credentials|login)
    echo "🔑 Extrayendo credenciales de Sesame HR..."
    python3 get-token.py
    ;;
  lan|network|red)
    echo "🌐 Iniciando Sesame Premium Dashboard en modo red local..."
    echo "⚠️  Cualquiera con acceso a esta red y la contraseña maestra podrá abrir el panel."
    SESAME_HOST="${SESAME_HOST:-0.0.0.0}" SESAME_LAN=1 python3 server.py
    ;;
  local|localhost|loopback)
    echo "🚀 Iniciando Sesame Premium Dashboard solo en este equipo..."
    SESAME_HOST="${SESAME_HOST:-127.0.0.1}" python3 server.py
    ;;
  help|-h|--help)
    ;;
  *)
    echo "🌐 Iniciando Sesame Premium Dashboard en modo red local..."
    echo "⚠️  Cualquiera con acceso a esta red y la contraseña maestra podrá abrir el panel."
    SESAME_HOST="${SESAME_HOST:-0.0.0.0}" SESAME_LAN=1 python3 server.py
    ;;
esac
