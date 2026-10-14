# Mac 开发环境

仓库目录：`~/Developer/linshoufu/node-flow`。Node 24、pnpm 10，Python 3.12 由 uv 管理，项目虚拟环境为 `.venv`。锁文件保留原样，依赖使用冻结安装。

## 启动

```sh
cd ~/Developer/linshoufu/node-flow
.codex/run.sh dev:api
```

另一个终端：

```sh
cd ~/Developer/linshoufu/node-flow
.codex/run.sh dev:web
```

打开 `http://127.0.0.1:5273`，API 是 `http://127.0.0.1:8150`。启动前检查端口占用；Ctrl+C 停止。数据库默认在仓库根目录 `node-flow.sqlite3`，Git 排除它；测试使用临时数据库，不能覆盖实际工作流。

本机 `.npmrc` 通过 `.git/info/exclude` 排除，下载使用 `127.0.0.1:7890` 代理；uv 下载时可通过 HTTPS_PROXY 使用同一代理。本机访问通过 NO_PROXY 排除。

## VS Code

`code ~/Developer/linshoufu/node-flow` 打开；工作区配置指定 Node PATH、项目 Python 和本地 TypeScript，并提供常用任务。按 Cmd+Shift+B 构建前端；运行和调试选择“Node Flow：前后端一起启动”并按 F5，也可单独调试 API/浏览器。调试 API 使用不带 reload 的 uvicorn，避免断点进程切换；正常开发任务仍支持 reload。

Python、debugpy、Ruff 扩展提供后端调试和检查。若窗口处于受限模式，由本人确认信任当前项目文件夹后启用任务/调试。

## Codex

AGENTS.md 保留仓库原有约定，并补充 Mac 环境与不推送约定；`.codex/run.sh` 提供运行/检查入口。

在 Codex 侧边栏添加本地项目 node-flow，主文件夹选 `/Users/hayashijutomi/Developer/linshoufu/node-flow`，以后从该项目创建聊天。当前工具没有注册本地项目入口，也不能操作 Codex 自身界面，这一步由本人完成。

可在本地环境快捷操作中填写 `.codex/run.sh dev:web`、`.codex/run.sh dev:api`、`.codex/run.sh build:web`；新 worktree 初始化使用 `.codex/run.sh install`。这些新文件尚未提交，远端/HEAD worktree 暂不包含它们。

## 凭据与跨平台运行

凭据统一使用跨平台服务 AES-256-GCM。首次保存时在当前用户目录生成 `.node-flow/credential.key`，也可通过环境变量指定服务密钥或独立文件。携带数据库和相同的服务密钥即可跨 Windows、Mac、Linux 使用；配置见 [凭据存储](platform-behavior.md#凭据存储)。旧版凭据格式不再支持，需要重新录入。

根目录的 `pnpm dev:api`、`pnpm dev:worker`、`pnpm doctor:nodes` 和 `pnpm test:api` 通过 uv 使用项目 Python，不需要先激活 `.venv`。`pnpm test` 依次运行静态检查、前端测试和后端测试。CI 覆盖 Windows、macOS 与 Linux。

后端测试在仓库 `.tmp/` 下使用独立临时目录或内存数据库。凭据测试使用真实 AES-GCM 和每项测试独立的环境密钥，不访问用户的正式密钥文件及工作流数据库。

## 验证（2026-10-15）

前端 30 项测试、TypeScript、Ruff 和生产构建通过。后端全量测试为 477 项通过、2 项失败，失败是既有四个数据节点的文档链接和锚点检查；全目录节点自检另有既有 A3 节点包依赖 `a3-tool` 缺失问题。凭据仅保留服务 AES 实现，覆盖环境密钥、文件权限、密文认证、并发首次创建和失败不覆盖已有凭据。未执行远端 CI，未修改正式数据库，未提交或推送。
