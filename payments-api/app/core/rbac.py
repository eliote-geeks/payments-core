from __future__ import annotations

import casbin
from casbin.persist.adapters import FileAdapter
from fastapi import Depends, HTTPException
from pathlib import Path

from app.core.config import settings
from app.core.security import AuthUser, require_user
from app.services.users import get_user


MODEL = """
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = (p.sub == r.sub) && (p.obj == "*" || p.obj == r.obj) && (p.act == "*" || p.act == r.act)
"""


def _enforcer() -> casbin.Enforcer:
    model = casbin.Model()
    model.load_model_from_text(MODEL)
    policy_path = Path(settings.rbac_policy_path)
    if not policy_path.exists():
        policy_path = Path(__file__).with_name("rbac_policy.csv")
    return casbin.Enforcer(model, FileAdapter(str(policy_path)))


def user_roles(user_id: str) -> list[str]:
    row = get_user(user_id)
    profile = row.get("profile") if row else {}
    roles = profile.get("roles") if isinstance(profile, dict) else []
    if isinstance(roles, str):
        return [roles]
    return [str(role) for role in roles or []]


def require_permission(resource: str, action: str):
    def dependency(user: AuthUser = Depends(require_user)) -> AuthUser:
        enforcer = _enforcer()
        if any(enforcer.enforce(role, resource, action) for role in user_roles(user.id)):
            return user
        raise HTTPException(status_code=403, detail="Forbidden")

    return dependency
