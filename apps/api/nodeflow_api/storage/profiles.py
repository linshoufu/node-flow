import json
from uuid import uuid4

from .base import utc_now


class ProfileRepositoryMixin:
    def list_profiles(self):
        with self._lock:
            rows = self._connection.execute("SELECT document_json FROM resource_profiles ORDER BY id").fetchall()
        return [json.loads(row["document_json"]) for row in rows]

    def get_profile(self, profile_id):
        return next((profile for profile in self.list_profiles() if profile["id"] == profile_id), None)

    def save_profile(self, *, name, type_id, data, credential_id=None, profile_id=None):
        profile = dict(id=profile_id or f"profile_{uuid4().hex}", name=name,
                       type_id=type_id, data=data, credential_id=credential_id, updated_at=utc_now())
        with self._lock, self._connection:
            self._connection.execute(
                "INSERT OR REPLACE INTO resource_profiles (id, document_json) VALUES (?, ?)",
                (profile["id"], json.dumps(profile)),
            )
        return profile

    def delete_profile(self, profile_id):
        with self._lock, self._connection:
            return self._connection.execute("DELETE FROM resource_profiles WHERE id = ?", (profile_id,)).rowcount > 0
