#!/usr/bin/env bash
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
python3 server.py
