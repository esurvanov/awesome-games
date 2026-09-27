#!/bin/sh
# Локальный сервер: ES-модули не работают через file://
cd "$(dirname "$0")" && python3 -m http.server "${PORT:-8123}"
