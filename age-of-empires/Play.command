#!/bin/bash
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv && .venv/bin/pip install -q pygame-ce numpy
fi
# numpy is needed for procedural sound and music (without it the game runs silent)
.venv/bin/python -c "import numpy" 2>/dev/null || .venv/bin/pip install -q numpy
exec .venv/bin/python main.py
