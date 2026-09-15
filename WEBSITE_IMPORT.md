# 网站资源导入 MVP

管理员在“投稿 → 从网站导入”选择 TuringCourses 或 BMS Database，扫描公开课程目录，确认课程、标题、分类后批量送审。课程资源保存外部链接与来源信息；不下载附件或转载正文。

## 开发与部署基线

- PR 目标为 `Ltto123/zju-guide` 的 `master`；贡献分支为 `Eason-Iron/zju-guide:feat/website-resource-import`，基于上游提交 `82e08f1`。
- 上游基线已采用 PostgreSQL，本功能提供增量迁移，不引入 SQLite → PostgreSQL 转换。仍运行旧版 SQLite 的部署需要单独规划数据迁移。
- `Eason-Iron/zju-guide` 仅作为外部贡献的代码来源，不是本功能的发布目标。
- 新增 CI 仅验证代码，不会发布服务器；最终部署环境、备份和 worker 的启动方式由维护者确认。
- 本地试验与 Fork CI 已通过，尚未部署到生产。CI 记录：[34332877804](https://github.com/Eason-Iron/zju-guide/actions/runs/34332877804)。

## 接口与数据

- `GET /api/admin/website-imports`：来源清单与最近 50 个持久化任务。
- `POST /api/admin/website-imports {sourceId}`：创建扫描，支持两个预置 id、名称或对应 URL；当前从配置的站点根目录扫描，不支持自选子目录。
- `GET /api/admin/website-imports/:id`：任务进度、候选、匹配建议及课程名称。
- `PATCH /api/admin/website-imports/:id`：`action=update` 保存候选并确认课程；`cancel` 停止扫描；`withdraw` 撤回本批新建资源。
- `POST /api/admin/website-imports/:id {candidateIds}`：逐项返回送审、重复或失败结果。
- `GET /api/admin/submissions?batch=id`：按导入批次审核。

所有导入端点同时校验 JWT ADMIN 和数据库当前角色，且需要 `WEBSITE_IMPORT_ENABLED=true`。每批最多 30 条，每管理员每天最多 100 条（上海日期）；最多 3 个活动任务，每管理员每天最多 20 次扫描。扫描单页 2 MB、10 秒超时、瞬态失败重试一次、同站至少间隔 1 秒。

迁移 `20260908160000_website_import` 是相对 PostgreSQL 新版的增量迁移：新增任务和候选表，在 Resource 上添加可选来源字段、批次关联和唯一导入键。不会替旧版 SQLite 完成数据库转换。

任务由独立 worker 领取，租约 90 秒、每 20 秒续期；重启后重新扫描未完成任务，候选按链接幂等写入，人工修改不被覆盖。批量送审以 PostgreSQL 事务锁串行执行配额与去重检查。撤回将本批次资源设为 REJECTED、关闭投稿记录并留下审计；预先存在的重复资源不受影响。

## 本地运行

准备隔离 PostgreSQL 测试库，勿将验证命令指向生产数据库。环境变量设置：

```text
DATABASE_URL=postgresql://msewiki:msewiki@127.0.0.1:5432/msewiki_test
TEST_DATABASE_URL=postgresql://msewiki:msewiki@127.0.0.1:5432/msewiki_test
JWT_SECRET=仅供本地的随机值
JWT_REFRESH_SECRET=另一个本地随机值
WEBSITE_IMPORT_ENABLED=true
```

```sh
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm dev
# 另一个终端，使用相同环境变量
pnpm worker:website-import
```

以已有 ADMIN 测试账户登录；新注册账户没有导入权限。不提供生产账户或通用管理员密码。

```sh
pnpm typecheck
pnpm test:unit
pnpm test
pnpm build
# 只读目录解析试验，输出 output/website-import/fixture-trial.json
pnpm exec tsx scripts/website-import-trial.ts
# 对公开来源发请求，不写数据库
pnpm exec tsx scripts/website-import-trial.ts --live
# 浏览器 UI 合同测试使用拦截响应，不代表数据库端到端测试
pnpm exec playwright test tests/e2e/website-import.spec.ts --workers=1
```

浏览器测试默认访问 localhost:3000；可通过 `NEXT_PUBLIC_APP_URL` 指向正在运行的本地实例。

## 试验记录

2026-09-08/09，本次会话保存的公开 HTML 目录解析：

| 来源 | 目录发现数 | 试验选取 | 唯一课程建议 | 多课程候选 | 未匹配 |
|---|---:|---:|---:|---:|---:|
| TuringCourses | 69 | 20 | 18 | 2 | 0 |
| BMS Database | 39 | 10 | 10 | 0 | 0 |

匹配依据来自仓库中的课程清单。以上是匹配建议覆盖情况，不是人工核验后的匹配准确率；发现总数亦不等于已经逐页验证可访问的资源数。

已运行 208 项单元测试、类型检查及生产构建通过；完整测试共 20 个文件、288 项通过，包含真实 PostgreSQL 集成测试。2 项浏览器交互合同测试通过（管理员确认、送审和撤回；普通用户隐藏入口），使用模拟 API 响应。2026-09-09 本地 PostgreSQL 18 在 127.0.0.1:55432 完成全部 5 个迁移；CI 使用 PostgreSQL 16。

真实来源 MVP 于 2026-09-09 09:04 UTC 在隔离本地测试库完成：worker 实际扫描两个来源，各达到 30 条候选上限；逐页核验 Turing 20 条与 BMS 10 条，全部可访问。按课程名和页面主标题程序核验，27 条完成候选确认 → DRAFT 送审 → 真实审核路由 APPROVED → 批次撤回；重复送审未增加投稿记录。另 3 条保留待人工核验（包括多课程候选），没有强行入库。所有试验批次已撤回，审计保留。逐项证据在 `output/website-import/live-db-trial.json`，试验脚本保存在本地 `tmp/live-db-trial.ts`。

这不是人工匹配准确率或浏览器端到端验证；人工耗时对照、线上 5 条试验及 48 小时观察尚未完成。集成测试只允许 localhost 且名称以 `_test` 结尾的数据库，通过 `TEST_DATABASE_URL` 同时配置初始化和测试进程，避免两者指向不同数据库。

UI 截图与 JSON 原始结果在 `output/website-import/`；截图使用 API 拦截响应，只用于展示和验证交互。

## 上线和撤回步骤

1. 确认实际部署服务和应用版本，核对生产数据库类型、版本及 migration 历史。
2. PostgreSQL 新版先做数据库备份，并验证备份可恢复；数据库若是 SQLite，另行完成转换和核对，禁止直接套用增量迁移。
3. 在测试环境验证 `prisma migrate deploy` 和 worker。导入 Compose 覆盖配置使用独立迁移服务，并覆盖原来的 `db push` 与 seed 启动命令；迁移成功后才启动 app 和 worker。
4. 设置 `WEBSITE_IMPORT_ENABLED=true`；应用和 worker 必须使用同一数据库与开关。默认基础部署仍不启用此功能，显式使用导入覆盖配置才启动完整导入服务。
5. 合并 `docker/website-import.compose.yml` 的命令见下方；无需 profile，只启动一个 worker。
6. 导入 5 条经人工验证的真实链接，逐条审核，核对课程页与资源页，记录批次 ID。
7. 观察 48 小时内的失败、重复和链接问题。异常时关闭开关、停止 worker，使用“撤回批次”撤回新资源；保留增量表及审计，不进行破坏性反向迁移。

新增的 `website-import-ci.yml` 只做验证，不会发布站点。没有创建周期监控，也没有安排尚未上线功能的定时任务。

## 部署后不可用：修复与验收

“导入服务暂不可用”是未分类的 API 500，单凭截图不能确定服务器根因。缺少导入迁移时 Prisma P2021（缺表）/P2022（缺字段）可以复现该现象；修复后返回 `503 IMPORT_SCHEMA_NOT_READY` 和数据库升级提示，日志包含错误码与处理方向。`IMPORT_DISABLED` 表示应用开关未启用；一直排队则需检查 worker 是否运行、其开关和数据库是否与应用一致。

旧覆盖配置的 worker 带 profile，文件顶部的启动示例却没有启用该 profile，导致仅启动应用。现在显式使用覆盖文件即可启动迁移服务与 worker，且迁移失败会阻止新版应用/worker 启动。

有 migration 历史的 PostgreSQL 部署：备份并在测试环境验证后，从仓库根目录执行（沿用现有 Compose 项目名、数据卷和端口配置）：

```sh
# 在 .env 中设置 WEBSITE_IMPORT_ENABLED=true；不要提交凭据
docker compose --env-file .env -f docker/docker-compose.yml -f docker/website-import.compose.yml up -d --build
docker compose --env-file .env -f docker/docker-compose.yml -f docker/website-import.compose.yml ps -a
docker compose --env-file .env -f docker/docker-compose.yml -f docker/website-import.compose.yml logs --tail=100 website-import-migrate website-import-worker app
```

迁移服务应退出码 0，app 和 worker 应保持运行。应用与迁移/worker 的 `DATABASE_URL` 必须完全对应同一数据库；使用自定义外部数据库时需同时覆盖三个服务的连接配置。当前覆盖文件沿用基础 Compose 的内置 db。新库的课程、管理员数据需要维护者按既有方式首次初始化，本流程不会在每次部署重跑 seed。

**如果旧生产库通过 `db push` 建表而没有 migration 历史**，`migrate deploy` 可能报 P3005；若部分表已存在但迁移未记账，也可能报 P3018。请维护者先备份、比较真实 schema 与迁移文件，按实际已存在的结构建立 Prisma baseline；只对已经逐项核实应用的迁移使用 `migrate resolve --applied <迁移名>`。不得把尚缺的导入迁移直接标记为已应用，不要删除数据库、reset 或盲目重复 SQL。本修复会在此状态停止部署并保留现有数据，不会自动猜测基线。

非 Docker 部署应在相同环境变量下执行 `pnpm exec prisma generate`、`pnpm exec prisma migrate deploy`，重新构建/重启应用，并用现有进程管理器持续运行 `pnpm worker:website-import`；不要只部署 `.next` 而漏掉 worker 脚本、`src/lib`、Prisma Client 和运行依赖。

验收：管理员打开导入页能列出来源；创建一个扫描后任务从排队进入完成并出现候选，再选少量真实链接确认、送审与审核。若仍报通用 500，请维护者提供对应时间的服务端错误码，不能仅凭界面判定已修复。

回滚：停止 worker、关闭应用开关，并部署先前兼容版本；保留增量表与数据。若要撤回已导入资源，应先在开关仍启用时使用批次撤回，再关闭功能。

部署回归检查（仅限 localhost、名称以 `_test` 结尾的隔离测试库）：

```sh
node tests/deployment/website-import-compose.mjs
pnpm exec tsx tests/deployment/website-import-upgrade.ts
```

第二项在随机独立 schema 中应用旧版迁移，验证缺表提示、升级后真实管理员 API、worker 持久化候选及重复迁移保留数据，结束后清理本次 schema。CI 会运行这两项，且在全量测试前实际执行迁移。

## 转发给服务器管理员

请协助确认 `106.14.218.12:8080` 的以下信息：

1. 服务器由谁管理，使用 SSH、宝塔、1Panel、Docker Compose 或其他平台；提供平台项目链接或安全授予访问的方式。
2. 应用所在目录、启动/重启方式、容器或服务名，以及当前部署的仓库、分支、提交。
3. 数据库类型（SQLite/PostgreSQL）、版本、数据位置，以及备份和恢复方式；用户上传文件存储位置。
4. 是否已有 GitHub 自动部署：对应 workflow、webhook、runner 或平台项目；若使用 Secrets，只提供名称及是否配置，不发送值。
5. 能否先部署测试环境、执行迁移并运行一个后台 worker；可接受的维护时间及失败回滚方式。

密码、数据库连接密码、令牌和私钥应通过服务器平台或 GitHub Secrets 安全配置，不放入 PR 或聊天。
