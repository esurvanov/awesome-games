#!/bin/bash
# Эхо Разлома — запуск: обычный статический сервер, браузер открывается сам.
cd "$(dirname "$0")"
PORT=8790
PAGE=index.html; [ -f open-world.html ] && PAGE=open-world.html
( sleep 1; open "http://localhost:$PORT/$PAGE" ) &
exec python3 -m http.server $PORT --bind 127.0.0.1
