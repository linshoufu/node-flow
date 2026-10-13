"""Repeatable local API for single, authenticated and CSV-driven demo workflows."""

import secrets

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, SecretStr


# Public, fictional demo account; never put real service credentials here.
DEMO_USERNAME = "demo"
DEMO_PASSWORD = "demo-only-password"
PRODUCTS = (
    {"id": "pencil", "name": "铅笔", "unit_price_cents": 200},
    {"id": "notebook", "name": "笔记本", "unit_price_cents": 1200},
)


class LoginRequest(BaseModel):
    username: str
    password: SecretStr


class OrderRequest(BaseModel):
    reference: str = Field(min_length=1, max_length=80)
    product_id: str = Field(min_length=1, max_length=80)
    quantity: int = Field(ge=1, le=100)


def create_app() -> FastAPI:
    app = FastAPI(title="Node Flow 本地演示 API")
    sessions: set[str] = set()

    def require_session(authorization: str | None) -> None:
        if authorization not in sessions:
            raise HTTPException(status_code=401, detail="请先登录演示 API")

    @app.get("/health")
    def health():
        return {"service": "node-flow-demo-api", "status": "ok"}

    @app.get("/echo")
    def echo(message: str = "hello-node-flow"):
        return {"message": message, "source": "node-flow-demo-api"}

    @app.post("/login")
    def login(request: LoginRequest):
        if request.username != DEMO_USERNAME or request.password.get_secret_value() != DEMO_PASSWORD:
            raise HTTPException(status_code=401, detail="演示账号或密码不正确")
        authorization = f"Bearer {secrets.token_urlsafe(24)}"
        sessions.add(authorization)
        return {"data": {"authorization": authorization, "username": DEMO_USERNAME}}

    @app.get("/products")
    def products(authorization: str | None = Header(default=None)):
        require_session(authorization)
        return {"products": PRODUCTS}

    @app.post("/orders", status_code=201)
    def create_order(request: OrderRequest, authorization: str | None = Header(default=None)):
        require_session(authorization)
        product = next((product for product in PRODUCTS if product["id"] == request.product_id), None)
        if product is None:
            raise HTTPException(status_code=404, detail=f"不存在的演示商品：{request.product_id}")
        # The response is calculated only: repeat runs do not accumulate business records.
        return {"order": {
            "id": f"demo-{request.reference}",
            **request.model_dump(),
            "product_name": product["name"],
            "total_cents": request.quantity * product["unit_price_cents"],
        }}

    return app


app = create_app()
