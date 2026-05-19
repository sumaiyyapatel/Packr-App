import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).parent / 'backend'
sys.path.insert(0, str(BACKEND_DIR))

from server import app  # noqa: E402
