import json

from .base import utc_now


class UserTemplateConflict(ValueError):
    pass


class UserTemplateRepositoryMixin:
    def list_user_templates(self, *, include_deleted=False):
        with self._lock:
            rows = self._connection.execute("SELECT document_json FROM user_templates ORDER BY created_at DESC, id").fetchall()
        assets = [json.loads(row["document_json"]) for row in rows]
        return [asset for asset in assets if include_deleted or not asset.get("deletedAt")]

    def get_user_template(self, template_id):
        with self._lock:
            row = self._connection.execute("SELECT document_json FROM user_templates WHERE id = ?", (template_id,)).fetchone()
        return json.loads(row["document_json"]) if row else None

    def save_user_template(self, document):
        asset = {**document, "createdAt": utc_now(), "revision": 1}
        with self._lock, self._connection:
            self._connection.execute("INSERT INTO user_templates (id, document_json, created_at) VALUES (?, ?, ?)", (asset["id"], json.dumps(asset, ensure_ascii=False), asset["createdAt"]))
        return asset

    def update_user_template(self, template_id, expected_revision, changes):
        with self._lock, self._connection:
            row = self._connection.execute("SELECT document_json FROM user_templates WHERE id = ?", (template_id,)).fetchone()
            if row is None:
                raise KeyError(template_id)
            original = json.loads(row["document_json"])
            if original.get("revision", 1) != expected_revision:
                raise UserTemplateConflict("资源已被其他操作修改，请刷新后重试")
            asset = {**original, **changes, "id": template_id, "source": "user", "createdAt": original["createdAt"], "revision": expected_revision + 1, "updatedAt": utc_now()}
            updated = self._connection.execute("UPDATE user_templates SET document_json = ? WHERE id = ? AND document_json = ?", (json.dumps(asset, ensure_ascii=False), template_id, row["document_json"]))
            if updated.rowcount != 1:
                raise UserTemplateConflict("资源已被其他操作修改，请刷新后重试")
        return asset
