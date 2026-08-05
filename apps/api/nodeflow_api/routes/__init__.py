"""routes 子包：按领域拆分的 API 路由。

每个模块暴露一个 build_*_router(...) 工厂函数，返回带显式依赖的 APIRouter；
main.create_app 只负责装配依赖并按原注册顺序挂载路由。
"""
