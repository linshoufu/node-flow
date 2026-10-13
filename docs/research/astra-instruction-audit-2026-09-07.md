# Astra 指令调整记录

日期：2026-09-07。目标：当前 Node Flow 工作区和本机 Codex 个人指令。

## 材料与读取边界

- [OpenAI 官方 GPT-6 Astra 模型指南](https://developers.openai.com/api/docs/guides/latest-model)：已读取页面正文全部章节，包括行为、提示、验证和迁移说明。
- [Eric Provencher 原文](https://x.com/pvncher/status/2095991462416490862)：X 直接抓取失败、浏览器访问超时后，经 [FxTwitter 公开数据镜像](https://api.fxtwitter.com/pvncher/status/2095991462416490862) 读取完整英文正文；返回作者为 `pvncher`，标题匹配，文章 ID 为 `2095989703967125509`。正文涵盖 Skill files、AGENTS.md、Decision boundaries、Persistence。两张示例插图未能加载，不能声称完成了图片内容核验。未把中文转载当作原始依据。

落地原则：删去不必要的流程约束，缩小技能触发范围；把任务完成标准、权限边界和验证范围说明白。流程细节按需要读取，保留真实的项目契约和工具要求。这是结合本地文件的判断，不是逐字复制文章模板。

## 实际指令来源

- 项目 `AGENTS.md` 是本轮用户明确提供且磁盘上存在的项目指令。检查了祖先目录，未发现额外 `AGENTS*`；项目未发现 `.codex` / `.agents` 指令覆盖。
- `C:/Users/Administrator/.codex/AGENTS.md` 原来为空，本次加入简短的个人协作偏好。
- 本轮目录中可发现的 12 个个人技能已全文检查，必要时继续读取其参考文件和脚本：code-review、codebase-design、diagnosing-bugs、domain-modeling、grilling、impeccable、prototype、research、resolving-merge-conflicts、tdd、wizard、writing-for-agents。
- 完整读取了本任务使用的系统技能 openai-docs、skill-creator、writing-for-agents 及相关迁移、技能机制和 YAML 元数据说明。读取一个技能来审计其文字，不等于执行其中的业务流程。
- 其他插件技能属于可发现、按任务加载的能力。本次核对其会话描述、来源和部分相关入口要求，未逐页审计未触发插件的全部正文及参考文件；没有修改受插件管理的缓存或系统技能，也没有安装、禁用或卸载技能。
- `.qoder/skills`、`.opencode/skills` 和未出现在本轮可用目录中的个人技能，不视为本轮自动生效的 Codex 技能，保持原样。
- `config.toml` 已选择 `gpt-6-astra` / `medium`；未发现需要迁移的自定义指令文件设置，保持模型、推理强度、权限和工具配置不变。`default.rules` 的 73 条记录均为命令允许规则，保持原样。只读检查记忆库，`stage1_outputs` 为 0 条。
- 宿主注入的系统、开发者和工具指令不能通过编辑项目文件替换。本次改动不会追溯替换本轮已注入的旧文本；后续加载时读取新版，建议用新任务验证完整加载效果。

## 已完成的修改

| 文件或技能 | 修改及原因 |
| --- | --- |
| 项目 AGENTS.md | 删除重复安装教程、过期控制器地图和易漂移的配置复述；指向实际 Zustand store；保留网络、凭据、事务、并发和节点契约；加入按影响面验证的入口。 |
| 个人 AGENTS.md | 简洁中文、在授权范围内持续完成、按需提问和验证；明确技能及历史任务授权的边界。 |
| diagnosing-bugs | 移除“先复现才可分析”、固定假设数量和强制架构交接；无法复现时继续有用分析并注明不确定性。 |
| tdd | 保留真正的测试先行；移除既有接口的逐次确认，允许保持测试绿色的重构；区分集成测试请求和完整 TDD 实现。 |
| code-review | 正确区分 PR、分支、精确提交和未提交改动；缺少 spec 或 issue-tracker 不阻塞；优先可证实问题，按收益委派。 |
| resolving-merge-conflicts | 仅暂存本次冲突相关文件或片段；按用户要求决定是否完成合并或仅留下供审查的结果，尊重停止或 abort 请求。 |
| prototype 与两份参考 | 原型交付不自动升级为生产实现、提交分支或写 issue；允许为确认设计问题进行必要验证。 |
| research、grilling、wizard | 收窄流程范围；按必要性委派或提问；生成向导不先要求仪式性确认，保留真实不可逆操作的授权要求。 |
| codebase-design、domain-modeling | 尊重项目已有术语和文档用途，避免术语模板覆盖实际项目上下文。 |
| writing-for-agents 与技能机制 | 精简通用流程说明；按 Codex 的 `agents/openai.yaml` 说明调用策略，保持现有调用策略。 |
| impeccable 及相关参考 | 收窄描述；移除固定方向抽签、反复选图、强制问答和固定交接前置条件；按范围评估、实现、验证；将视觉偏好与功能、可访问性要求分开。 |
| impeccable/scripts/context.mjs | 修复输出声称可以覆盖系统指令、虚构子代理授权，以及缺 PRODUCT.md 就强制先采访的问题；保留上下文查找功能。 |
| PRODUCT.md、DESIGN.md | 将旧重设计授权标为历史，修正指向已删除 CanvasEmptyState 的入口。 |

共修改 25 个现有文件，其中 12 个为个人 SKILL.md；另新增本报告。业务代码、现有工作区改动、服务和数据库数据未由本任务修改。未提交或推送 Git。

## 验证

- 12 个技能的 YAML 必填字段及名称有效；改动 Markdown 的相对引用均可解析；修改的 openai.yaml 解析通过。
- 通用 quick_validate 对 11 个技能通过。Impeccable 保留其工具读取的原有顶层 `version` 字段，通用校验器会拒绝这个扩展字段；备份原版同样失败，非本次引入。没有为了消除提示破坏其版本读取约定。
- `node --check` 通过；修改后的 context.mjs 在当前项目目标和空目录分别实际运行，均退出 0；输出能解析已有 PRODUCT / DESIGN，缺文件时不强制采访。
- 独立代理评估了 5 个场景：缺生产复现的修复、既有 API 的 TDD、无 spec 的未提交改动审查、指定 padding 和中文截断修复、缺 PRODUCT.md 的完整落地页。其发现的 layout / craft-floor 残留冲突已修正并复核。
- 本次为指令和一个上下文输出脚本修改，因此没有运行业务全量测试；行为评估是场景推演，不等同于长期真实任务效果保证。

## 回退与维护

备份目录：`C:/Users/Administrator/.codex/backups/astra-2026-09-07/`。

`manifest.json` 记录原路径、备份路径和原始 SHA-256；`changes.diff` 提供统一差异；`changed.json` 列出修改文件；`validation.json` 和两份 context 输出保存验证证据。恢复时按清单逐文件取回原版，先比较之后是否又有用户改动。新增报告可独立移除。

个人技能的修改影响后续其他项目中的 Codex 使用；若重新安装或更新同名技能，上游版本可能覆盖这些本地修改，可用备份中的差异核对。插件未触发分支和其他模型的实际行为不在本次验证范围内。
