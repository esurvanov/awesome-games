#!/bin/bash
# Эхо Разлома — запуск. С Node.js: игра + AI-сервер (ключ из .env). Без Node: обычный статический сервер, игра на правилах.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
PORT=8790
PAGE=index.html; [ -f open-world.html ] && PAGE=open-world.html
if command -v node >/dev/null 2>&1 && [ -f server/server.mjs ]; then
  exec node server/server.mjs --port $PORT --page $PAGE --open
else
  echo "Node.js не найден — запуск без AI (python http.server)"
  ( sleep 1; open "http://localhost:$PORT/$PAGE" ) &
  exec python3 -m http.server $PORT --bind 127.0.0.1
fi
