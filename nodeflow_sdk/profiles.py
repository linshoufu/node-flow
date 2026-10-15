from dataclasses import dataclass

from pydantic import BaseModel


@dataclass(frozen=True)
class ProfileType:
    """Package-owned non-secret configuration shared by several node types."""

    id: str
    name: str
    model: type[BaseModel]
    credential_type_ids: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "schema": self.model.model_json_schema(),
            "credentialTypeIds": list(self.credential_type_ids),
        }
