#!/usr/bin/env bash
set -e

# Ashh startup script
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "Initializing Ashh..."

# Create virtual environment if it does not exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv || python -m venv .venv
fi

# Activate virtual environment
if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
elif [ -f ".venv/Scripts/activate" ]; then
    source .venv/Scripts/activate
fi

# Copy .env.example to .env if missing
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "Creating default .env from .env.example..."
        cp .env.example .env
    fi
fi

# Install requirements
echo "Installing / verifying dependencies..."
pip install -r requirements.txt

# Print launch message
echo ""
echo "=========================================================="
echo "Ashh is running at http://localhost:8000 - open it in Chrome"
echo "=========================================================="
echo ""

# Start server
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
