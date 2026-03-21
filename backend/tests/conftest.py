from __future__ import annotations

import sys
from pathlib import Path

# Ensure `app` (backend/app) is importable regardless of current working directory.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
