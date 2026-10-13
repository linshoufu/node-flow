# Cordis 插件模型与 Node Flow 适配分析

> 调研日期：2026-08-14；基线：Cordis 官方仓库提交 [`8cc9e33`](https://github.com/cordiverse/cordis/tree/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4)，核心包 `4.0.0-rc.8`。

## 结论

Node Flow **可以借助 Cordis 做可选的 Node.js/TypeScript 插件宿主，但不能把现有 Python 节点直接变成 Cordis 插件**。更合适的方式是：Cordis 插件注册“节点提供者”，通过 HTTP/RPC 调用 Node Flow；Node Flow 继续掌管节点契约、执行、队列、取消、日志、凭据和事务。

当前 Cordis 仍有显著接入风险：官方明确称其处于活跃开发中，API 未稳定且可能无预告变化；核心版本也仍是 RC。[官方 README](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/README.md#L1-L10)；[包元数据](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/package.json#L1-L21)

## Cordis 插件模型

Cordis 插件是可执行 JS 模块，可为 `(ctx, config) => ...` 函数、接收同样参数的构造器，或带 `apply(ctx, config)` 的对象；还能声明 `name`、`Config`、`inject`、`provide` 等元数据。它不是声明式“工作流节点”。[插件类型](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/registry.ts#L63-L93)

每个插件实例由 Fiber 管理，状态包括 `PENDING / LOADING / ACTIVE / FAILED / DISPOSED / UNLOADING`。[Fiber 状态](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/fiber.ts#L78-L85) 插件或 `ctx.effect()` 可返回清理函数；Fiber 卸载时自动回收监听器等副作用，依赖恢复后可重载。[副作用清理](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/fiber.ts#L275-L334)；[依赖触发重载](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/fiber.ts#L385-L458)

依赖注入按服务名工作：插件用 `inject` 声明依赖；服务缺失时 Fiber 不激活，服务变化会刷新依赖者。[依赖声明](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/registry.ts#L17-L58) 服务通过 `ctx.provide()` 或 `Service` 基类注册；Context 的 `extend/isolate` 提供作用域隔离，但不是进程或安全沙箱。[服务注册](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/reflect.ts#L175-L202)；[Context 隔离](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/context.ts#L46-L65)

插件 `Config` 使用 Standard Schema 同步校验；异步校验被明确拒绝。[配置校验](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/fiber.ts#L20-L47) 事件总线支持 `emit / parallel / serial / bail / waterfall`，监听器随 Fiber 自动清理；这是内存内、Context 范围的机制，不是持久化或跨进程消息总线。[事件模式](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/events.ts#L14-L38)；[分派实现](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/events.ts#L89-L126)

## 语言、发布与装载

Cordis 核心是 ESM npm 包。Loader 用 Node 动态 `import()` 装载 npm 裸模块名、本地相对模块或 `cordis:` 内建模块，并优先解包 `default` 导出。[装载实现](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/loader/src/config/tree.ts#L103-L119)；[导出解包](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/loader/src/index.ts#L156-L163)

因此它的原生运行时是 JavaScript/TypeScript（TS 需成为 Node 可装载产物），**没有 Python 插件 ABI**。Python 节点只能由 JS 插件通过 FastAPI、子进程或 IPC 间接调用。Loader 直接执行模块，也未提供 Node Flow 现有 ZIP 安装事务、Doctor 契约校验、权限或沙箱机制。

## 对 Node Flow 的关键约束

1. Cordis Fiber 是长驻组件；Node Flow 节点是一次工作流运行中的单步执行。不能把两种生命周期等同。
2. Cordis `Config/inject` 分别是插件实例配置和运行时服务依赖，不能替代 Node Flow 的端口、连线类型、表单、凭据引用、动态端口和版本迁移。
3. Cordis 事件不能替代 SQLite 队列、独立 Worker 协调和跨运行事务；跨 Python/Node 进程必须另建可靠协议。
4. 插件宿主卸载与单次节点协作式取消必须分别建模；秘密值不得进入 Cordis 长驻 Context。
5. 动态导入会执行任意 JS，Cordis 不是不可信插件的安全边界；远程市场仍需包校验、权限和进程/容器隔离。

建议：近期不要把 Cordis 定为 Node Flow 官方节点 ABI。若确需 TypeScript 生态，先做版本锁定、实验性的进程外桥接器，对外暴露 Node Flow 自有的窄 RPC 协议；Python 节点继续沿用现有 SDK、包清单和 Doctor。
