from __future__ import annotations

import os

LOCAL_API_PORT = 8150
LOCAL_WEB_PORT = 5273
LOCAL_WEB_FALLBACK_PORT = 5274
EXTRA_CORS_ORIGINS_ENV = "NODE_FLOW_EXTRA_CORS_ORIGINS"


def local_web_origins() -> list[str]:
    defaults = [
        f"http://127.0.0.1:{LOCAL_WEB_PORT}",
        f"http://localhost:{LOCAL_WEB_PORT}",
        f"http://127.0.0.1:{LOCAL_WEB_FALLBACK_PORT}",
        f"http://localhost:{LOCAL_WEB_FALLBACK_PORT}",
    ]
    configured = [
        origin.strip().rstrip("/")
        for origin in os.getenv(EXTRA_CORS_ORIGINS_ENV, "").split(",")
        if origin.strip()
    ]
    return list(dict.fromkeys([*defaults, *configured]))
