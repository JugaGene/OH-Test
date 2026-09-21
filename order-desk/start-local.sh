#!/usr/bin/env bash
# Local-only. Binds to this computer, not the network.
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
echo "GreenPeas order desk — http://127.0.0.1:${PORT}"
echo "Do not deploy this folder. Close the window to stop."
python3 -m http.server "$PORT" --bind 127.0.0.1
