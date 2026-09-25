#!/bin/sh
# Все дымовые тесты + 3 прогона бота. Нужен playwright: cd tests && npm i
cd "$(dirname "$0")" && exec node run-all.js "$@"
