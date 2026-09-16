# 求是学径 (Qiushi Learning Path)

> 浙江大学课程学习路径共建平台 -- 从培养方案到课程图谱，从散落资料到可信路径

求是学径是一个面向浙江大学本科生的课程学习路径共建平台。它把培养方案计算为按学期的行动清单，把散落的课程信息组织成结构化的知识页面，把学习资料通过投稿审核系统沉淀到课程关联中去。

---

## 核心功能

### 四类学习路径（解决「培养方案到学期行动」断裂）

| 路径组件 | 说明 | API |
|---------|------|-----|
| 本学期必修 | 当前学期应修读的必修课程列表 | `/api/me/path/required` |
| 通识进度 | 按通识模块分组的学分完成情况 | `/api/me/path/gen-ed` |
| 逾期警告 | 建议学期早于当前学期但未修完的必修课 | `/api/me/path/overdue` |
| 辅修进度 | 辅修方案各模块的学分完成情况 | `/api/me/path/minor` |

### 课程详情页（解决「课程信息到学习路径」断裂）

每门课程拥有 8 个信息分区：课程身份、为什么学（前置/后续/误区）、平时学习、小测、期中、期末（含复习路线 + 期末资源）、老师评价、图谱区（依赖树）；页面底部另有「跳转 98」独立入口直达 CC98 论坛讨论。

### 投稿审核系统（解决「散落资料到知识图谱」断裂）

同学投稿学习资料 → 管理员审核通过/驳回 → 资源关联到课程公开可见。支持 7 种资源类型（电子书、笔记、真题回忆、博客、CC98 帖子、工具模板、其他），按学习进度区分为 4 个阶段（平时学习/小测/期中/期末），并支持附件上传（50MB 内）。管理员可使用一键批量审核，对 1–100 条投稿批量通过。

### 网站资源导入（解决「外部站点资源沉淀」断裂）

管理员在「投稿 → 从网站导入」选择 TuringCourses 或 BMS Database，扫描公开课程目录，确认课程、标题、分类后批量送审。课程资源保存外部链接与来源信息，不下载附件或转载正文。支持自定义公开站点作为导入来源。后台 worker 独立领取扫描任务，候选按链接幂等写入，人工修改不被覆盖；每批最多 30 条、每管理员每天最多 100 条。详见 [网站导入部署说明](WEBSITE_IMPORT.md)。

### 课程信息修正（解决「课程主数据纠错」断裂）

管理员可在「课程修正」后台按培养方案预览课程清单、搜索课程并提交定点修正，支持冲突预览与二次确认，所有修改纳入审计日志。

### 其他

- **教务 JSON 导入**：兼容新旧格式，自动脱敏（学号/身份证号/姓名），Zod schema 校验
- **新手引导**：四步说明（培养方案 → 仪表盘 → 课程/资料 → 投稿），登录用户首次访问提示，移动端导航适配
- **账户管理**：修改用户名、上传头像（PNG/JPEG/WebP ≤ 1MB）、修改密码、查看个人投稿记录
- **附件预览**：授权后支持 PDF/PNG/JPG 在线预览，Range 分段读取，预览前校验扩展名/文件魔数/图片尺寸
- **JWT 认证**：三级角色（VISITOR / CONTRIBUTOR / ADMIN），access + refresh token
- **审计日志**：所有管理员操作记录（谁、什么时间、做了什么、理由）

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 全栈框架 | Next.js 15 (App Router) |
| 语言 | TypeScript (strict mode) |
| 样式 | Tailwind CSS v4 |
| 图标 | lucide-react |
| 数据库 ORM | Prisma 6 (SQLite 开发 / PostgreSQL 生产) |
| 认证 | jose (自建 JWT) |
| 数据获取 | TanStack Query (React Query) v5 |
| 表单 | react-hook-form + zod |
| 通知 | sonner (toast) |
| 测试 | Vitest (单元/集成) + Playwright (E2E) |
| 容器化 | Docker + Docker Compose |
| 包管理 | pnpm |

---

## 快速开始

### 前置要求

- Node.js >= 22
- pnpm >= 9

### 1. 克隆仓库

```bash
git clone <repo-url>
cd mse-wiki
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入真实的 JWT_SECRET、JWT_REFRESH_SECRET 等值
# 启用网站资源导入需额外设置 WEBSITE_IMPORT_ENABLED=true
```

### 3. Docker Compose 一键启动

```bash
cd docker
docker compose up -d
```

这会在后台启动两个容器：
- **app** (mse-wiki-app) -- Next.js 开发服务器，端口 `3000`
- **db** (mse-wiki-db) -- PostgreSQL 16，端口 `5432`

首次启动后需要进入容器执行数据库迁移和种子数据：

```bash
docker compose exec app sh
pnpm db:migrate:deploy
pnpm db:seed
```

### 4. 本地开发（不使用 Docker）

```bash
pnpm install
pnpm db:generate      # 生成 Prisma Client
pnpm db:migrate:dev   # 执行数据库迁移
pnpm db:seed          # 播种种子数据
pnpm dev              # 启动开发服务器 http://localhost:3000
```

启用网站资源导入时，另开终端运行后台 worker（需配置 `WEBSITE_IMPORT_ENABLED=true` 并执行增量迁移）：

```bash
pnpm worker:website-import
```

完整的网站导入部署步骤、Compose 合并、回滚和验收方法见 [网站导入部署说明](WEBSITE_IMPORT.md)。

### 5. 默认账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| 注册用户 | 自行注册 | 学生 (VISITOR) |

---

## 目录结构

```
├── prisma/
│   ├── schema.prisma           # 数据库 Schema
│   ├── seed.ts                 # 种子数据
│   └── migrations/             # 迁移文件（含网站导入增量迁移）
│
├── src/app/                    # Next.js App Router
│   ├── (auth)/                 # 认证页面
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (dashboard)/            # 登录后页面
│   │   ├── layout.tsx          # 布局（侧边栏 + 顶栏）
│   │   ├── page.tsx            # 仪表盘（学分进度 + 课程导图）
│   │   ├── onboarding/page.tsx # 引导页（选年级+专业）
│   │   ├── guide/page.tsx      # 新手引导（四步说明）
│   │   ├── courses/page.tsx    # 课程库（搜索+分页）
│   │   ├── course/[code]/      # 课程详情（8个折叠区块）
│   │   ├── contribute/page.tsx # 投稿页（含网站导入入口）
│   │   ├── import/page.tsx     # 教务JSON导入
│   │   ├── resources/page.tsx  # 资料搜索
│   │   └── settings/           # 设置页（个人信息/密码/投稿记录）
│   ├── admin/                  # 管理后台
│   │   ├── review/page.tsx     # 审核队列（含一键批量审核）
│   │   ├── import/page.tsx     # 培养方案导入
│   │   └── course-corrections/page.tsx  # 课程信息修正
│   └── api/                    # 后端 API
│
├── src/lib/                    # 工具库
│   ├── auth.ts                 # JWT 认证（jose + bcryptjs）
│   ├── api-client.ts           # 前端 API 封装
│   ├── path-engine.ts          # 四类路径计算引擎
│   ├── json-adapter.ts         # 教务 JSON 适配器（脱敏/多格式）
│   ├── website-import-service.ts   # 网站导入服务
│   ├── website-import-worker.ts    # 网站导入后台 worker
│   ├── website-sources.ts      # 导入来源（TuringCourses/BMS/自定义）
│   ├── course-correction.ts    # 课程定点修正逻辑
│   ├── submission-bulk-review.ts   # 批量审核逻辑
│   ├── constants.ts            # 统一标签常量
│   ├── prisma.ts               # Prisma 客户端单例
│   └── utils.ts                # cn() 工具
│
├── src/hooks/use-auth.tsx      # 认证 Context
├── src/components/
│   ├── providers.tsx           # React Query + Auth Provider
│   └── website-import-panel.tsx   # 网站导入面板组件
│
├── scripts/
│   ├── website-import-worker.ts    # worker 入口
│   └── website-import-trial.ts     # 只读导入试验
│
├── tests/
│   ├── unit/                   # 单元测试
│   ├── integration/            # 集成测试
│   ├── e2e/                    # Playwright E2E
│   └── deployment/             # 部署验收脚本
│
├── fixtures/                   # 测试JSON数据
├── docker/                     # Docker部署配置（含网站导入 Compose）
├── .github/workflows/          # CI Pipeline（ci + website-import-ci）
├── WEBSITE_IMPORT.md           # 网站导入部署说明
├── package.json
├── tsconfig.json
├── next.config.ts
└── .env.example
```

---

## 可用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动 Next.js 开发服务器 (Turbopack) |
| `pnpm build` | 生产构建 |
| `pnpm start` | 启动生产服务器 |
| `pnpm worker:website-import` | 启动网站资源导入后台 worker |
| `pnpm lint` | ESLint 代码检查 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm test` | 运行 Vitest 单元测试 |
| `pnpm test:unit` | 仅运行单元测试 |
| `pnpm test:e2e` | 运行 Playwright E2E 测试 |
| `pnpm db:migrate:dev` | 开发环境数据库迁移 |
| `pnpm db:migrate:deploy` | 生产环境数据库迁移 |
| `pnpm db:seed` | 播种种子数据 |
| `pnpm db:generate` | 生成 Prisma Client |
| `pnpm db:studio` | 打开 Prisma Studio |
| `pnpm format` | Prettier 格式化 |
| `pnpm format:check` | 检查格式 |

---

## API 概览

所有 API 统一响应格式：`{ data: T }` 或 `{ error: { code, message } }`

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/api/auth/register` | POST | 用户注册 | — |
| `/api/auth/login` | POST | 用户登录 | — |
| `/api/auth/me` | GET | 当前用户信息 | JWT |
| `/api/auth/me` | PATCH | 更新用户名/头像 | JWT |
| `/api/auth/password` | POST | 修改密码 | JWT |
| `/api/courses` | GET | 课程列表（分页/筛选） | — |
| `/api/courses/[code]` | GET | 课程详情（含前置/后续课） | — |
| `/api/courses/[code]/resources` | GET | 已审核资源列表 | — |
| `/api/me/programs` | GET/POST | 查看/选择培养方案 | JWT |
| `/api/me/imports` | GET/POST | 导入教务JSON/查看历史 | JWT |
| `/api/me/submissions` | GET | 个人投稿记录 | JWT |
| `/api/me/path/required` | GET | 本学期必修 | JWT |
| `/api/me/path/gen-ed` | GET | 通识进度 | JWT |
| `/api/me/path/overdue` | GET | 逾期警告 | JWT |
| `/api/me/path/minor` | GET | 辅修进度 | JWT |
| `/api/programs` | GET | 可选培养方案列表 | — |
| `/api/resources` | POST | 提交投稿 | JWT |
| `/api/resources/[id]` | GET/PATCH/DELETE | 查看/编辑/删除自己的投稿 | JWT |
| `/api/files/[name]` | GET/HEAD | 附件下载/预览（支持 Range） | JWT/ADMIN |
| `/api/search` | GET | 全局搜索 | — |
| `/api/admin/submissions` | GET | 审核列表（支持 `?batch=` 按导入批次筛选） | ADMIN |
| `/api/admin/submissions/[id]` | PATCH | 审核操作（通过/驳回） | ADMIN |
| `/api/admin/submissions/bulk-approve` | POST | 一键批量审核（1–100 条） | ADMIN |
| `/api/admin/programs/import` | POST | 培养方案批量导入 | ADMIN |
| `/api/admin/website-imports` | GET/POST | 网站导入来源列表/创建扫描任务 | ADMIN |
| `/api/admin/website-imports/[id]` | GET/PATCH/POST | 任务进度/确认送审/撤回 | ADMIN |
| `/api/admin/course-corrections` | GET/POST | 课程搜索/定点修正 | ADMIN |

---

## License

本项目为浙江大学X-Lab软件训练营实践项目
