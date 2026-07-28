"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  ChevronDown,
  GraduationCap,
  Clock,
  Target,
  Users,
  BookMarked,
  FileText,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  GitFork,
  MapPin,
  CheckCircle2,
  HelpCircle,
  TrendingUp,
  Sparkles,
  PenTool,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RESOURCE_TYPE_LABELS, APPLICABLE_STAGE_LABELS } from "@/lib/constants";
import { api } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────

interface Prerequisite {
  code: string;
  name: string;
  credits: number;
  semester: string | null;
  relationType: string;
  reason: string | null;
}

interface Dependent {
  code: string;
  name: string;
  credits: number;
  semester: string | null;
  relationType: string;
  reason: string | null;
}

interface Program {
  majorName: string;
  year: number;
  suggestedSemester: number;
  isCompulsory: boolean;
}

interface CourseData {
  code: string;
  name: string;
  credits: number;
  department: string | null;
  category: string | null;
  description: string | null;
  semester: string | null;
  prerequisites: Prerequisite[];
  dependents: Dependent[];
  programs: Program[];
}

interface TeacherReview {
  name: string;
  style: string;
  scoring: string;
  workload: string;
  comment: string;
}

interface KnowledgeGraphNode {
  code: string;
  name: string;
  level: "prerequisite" | "current" | "dependent";
  children?: KnowledgeGraphNode[];
}

// ─── Mock Data ───────────────────────────────────────────

const MOCK_TEACHERS: TeacherReview[] = [
  {
    name: "待评价",
    style: "暂无数据",
    scoring: "暂无数据",
    workload: "暂无数据",
    comment: "该课程暂无教师评价，欢迎贡献你的真实评价。",
  },
];

const MOCK_MISCONCEPTIONS = [
  "很多同学以为这门课是纯理论课，实际上有大量实验和项目需要动手。",
  "课程名里的「材料」容易让人以为只是记忆性质的内容，实际有不少数学推导。",
  "不要等到期末才开始复习，平时作业和实验的积累很重要。",
];

const MOCK_PREVIEW_POINTS = [
  "微积分 / 线性代数 基础（大一内容）",
  "基础化学或物理相关概念",
  "实验报告撰写规范",
];

const MOCK_PREVIEW_MATERIALS = [
  { title: "教材预习：第1-3章", url: "#" },
  { title: "MIT OCW 相关课程视频", url: "#" },
  { title: "往年学长笔记", url: "#" },
];

const MOCK_HOMEWORK_RATIO = "平时作业 40% + 期中 20% + 期末 40%";
const MOCK_ATTENDANCE = "课堂签到（学习通 / 钉钉）";
const MOCK_WEEKLY_RHYTHM = [
  { week: "第1-4周", focus: "基础概念与数学工具" },
  { week: "第5-8周", focus: "核心理论深入" },
  { week: "第9-12周", focus: "实验与项目实践" },
  { week: "第13-16周", focus: "综合复习与拓展" },
];

const MOCK_REVIEW_ROUTE = [
  "Step 1: 过一遍课件，整理知识框架（3天）",
  "Step 2: 刷近3年真题，总结题型（5天）",
  "Step 3: 重点章节精读 + 错题整理（4天）",
  "Step 4: 模拟考试 + 查漏补缺（2天）",
];

const MOCK_EXAM_CLUES = [
  "CC98 历年真题回忆帖（搜索课程名）",
  "打印店真题合集",
  "学长学姐传承的复习资料",
];

const MOCK_KEY_CHAPTERS = [
  { chapter: "第1-3章", weight: "约30%", note: "基础概念，必拿分" },
  { chapter: "第4-6章", weight: "约40%", note: "核心重点，拉分题型" },
  { chapter: "第7-9章", weight: "约30%", note: "综合应用" },
];

// ─── Sub-components ──────────────────────────────────────

const COURSE_SECTION_IDS = [
  "identity",
  "why",
  "preview",
  "during",
  "final",
  "teachers",
  "resources",
  "graph",
] as const;

/** Skeleton for preview cards during loading */
function SectionCardSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid animate-pulse grid-cols-1 gap-4 lg:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "min-h-44 border border-slate-200 bg-white p-5",
            i === 0 && "lg:col-span-2",
          )}
        >
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 bg-slate-200" />
            <div className="h-5 w-40 rounded bg-slate-200" />
            <div className="ml-auto h-4 w-16 rounded bg-slate-200" />
          </div>
          <div className="mt-6 h-3 w-5/6 rounded bg-slate-100" />
          <div className="mt-3 h-3 w-2/3 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

/** Empty state for optional sections */
function EmptyState({ message, icon: Icon }: { message: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-slate-400">
      <Icon className="h-10 w-10" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

/** Tag/badge component */
function Badge({
  variant = "default",
  children,
}: {
  variant?: "default" | "compulsory" | "elective";
  children: React.ReactNode;
}) {
  const styles = {
    default: "bg-slate-100 text-slate-700 border-slate-200",
    compulsory: "bg-blue-50 text-blue-700 border-blue-200",
    elective: "bg-amber-50 text-amber-700 border-amber-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        styles[variant],
      )}
    >
      {children}
    </span>
  );
}

/** Rectangular course section with a persistent content preview */
function CourseSectionCard({
  id,
  icon: Icon,
  title,
  badge,
  expanded,
  featured = false,
  onToggle,
  children,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  badge?: React.ReactNode;
  expanded: boolean;
  featured?: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "course-section-card min-w-0 border border-slate-200 bg-white transition-shadow hover:shadow-sm",
        (featured || expanded) && "lg:col-span-2",
      )}
    >
      <header className="flex min-h-14 items-center gap-3 border-b border-slate-100 px-5 py-3">
        <Icon className="h-[18px] w-[18px] flex-shrink-0 text-blue-600" />
        <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
        {badge && <div className="flex items-center">{badge}</div>}
        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-expanded={expanded}
          className="ml-auto inline-flex min-h-8 items-center gap-1.5 px-2 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-blue-700"
        >
          {expanded ? "收起" : "展开全部"}
          <ChevronDown
            className={cn(
              "h-4 w-4 flex-shrink-0 transition-transform duration-200",
              expanded && "rotate-180",
            )}
          />
        </button>
      </header>

      <div
        className={cn(
          "relative px-5 py-4",
          !expanded && "max-h-40 overflow-hidden",
        )}
      >
        {children}
        {!expanded && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white via-white/90 to-transparent"
          />
        )}
      </div>
    </section>
  );
}

/** Info row: label + value */
function InfoRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string | number | null | undefined;
  valueClassName?: string;
}) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-slate-400 min-w-[60px]">{label}</span>
      <span className={cn("text-sm text-slate-700", valueClassName)}>{value}</span>
    </div>
  );
}

/** Clickable course link chip */
function CourseChip({ code, name, type }: { code: string; name: string; type?: "prerequisite" | "dependent" }) {
  return (
    <Link
      href={`/course/${code}`}
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors",
        type === "prerequisite"
          ? "border-green-200 bg-green-50 text-green-800 hover:bg-green-100"
          : "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100",
      )}
    >
      <span className="course-code font-medium">{code}</span>
      <span className="text-xs opacity-70 truncate max-w-[120px]">{name}</span>
      <ExternalLink className="h-3 w-3 opacity-40 group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}

// ─── Main Page ───────────────────────────────────────────

export default function CourseDetailPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = params.code;

  const {
    data: response,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["course", code],
    queryFn: async () => {
      const res = await fetch(`/api/courses/${code}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error(`课程「${code}」不存在`);
        throw new Error("获取课程数据失败，请稍后重试");
      }
      const json = await res.json();
      return json.data as CourseData;
    },
  });

  const course = response;
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(),
  );
  const allSectionsExpanded = COURSE_SECTION_IDS.every((id) =>
    expandedSections.has(id),
  );

  const toggleSection = (id: string) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAllSections = () => {
    setExpandedSections(
      allSectionsExpanded
        ? new Set()
        : new Set(COURSE_SECTION_IDS),
    );
  };

  // ─── Loading ─────────────────────────────────────────────
  if (isLoading) {
    return (
      <main className="mx-auto max-w-[1400px] px-4 py-8 lg:px-6">
        {/* Header skeleton */}
        <div className="mb-8 animate-pulse">
          <div className="mb-4 h-5 w-20 rounded bg-slate-200" />
          <div className="mb-3 h-8 w-64 rounded bg-slate-200" />
          <div className="h-5 w-96 rounded bg-slate-200" />
        </div>

        <SectionCardSkeleton count={8} />
      </main>
    );
  }

  // ─── Error ────────────────────────────────────────────────
  if (isError || !course) {
    return (
      <main className="mx-auto max-w-[1400px] px-4 py-8 lg:px-6">
        <button
          onClick={() => router.back()}
          className="group mb-8 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>

        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-12 w-12 text-red-400" />
          <p className="mb-2 text-sm font-medium text-red-800">
            {error instanceof Error ? error.message : "加载失败"}
          </p>
          <p className="mb-4 text-xs text-red-500">
            {!isError && !course ? "课程数据为空" : "请检查课程代码是否正确，或稍后重试"}
          </p>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm text-red-700 transition hover:bg-red-100"
          >
            <RefreshCw className="h-4 w-4" />
            重新加载
          </button>
        </div>
      </main>
    );
  }

  // ─── Derived data ────────────────────────────────────────
  const isCompulsory = course.programs.some((p) => p.isCompulsory);
  const majorProgram = course.programs.length > 0 ? course.programs[0] : null;

  // Build knowledge graph tree
  const graphRoot: KnowledgeGraphNode = {
    code: course.code,
    name: course.name,
    level: "current",
    children: [
      // Prerequisites as children of "先修"
      {
        code: "__prereq_group__",
        name: "先修课程",
        level: "prerequisite",
        children: course.prerequisites.map((p) => ({
          code: p.code,
          name: p.name,
          level: "prerequisite" as const,
        })),
      },
      // Dependents as children of "后续"
      {
        code: "__dep_group__",
        name: "后续课程",
        level: "dependent",
        children: course.dependents.map((d) => ({
          code: d.code,
          name: d.name,
          level: "dependent" as const,
        })),
      },
    ],
  };

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8 lg:px-6">
      {/* ── Back + Header ─────────────────────────────────── */}
      <button
        onClick={() => router.back()}
        className="group mb-6 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        返回
      </button>

      <div className="mb-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="course-code rounded-md bg-blue-100 px-2.5 py-0.5 font-semibold text-blue-700">
            {course.code}
          </span>
          {isCompulsory ? (
            <Badge variant="compulsory">必修</Badge>
          ) : (
            <Badge variant="elective">选修</Badge>
          )}
          {course.programs.map((p) => (
            <Badge key={`${p.majorName}-${p.year}`}>
              {p.majorName} {p.year}级
            </Badge>
          ))}
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {course.name}
        </h1>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
          <div className="flex items-center gap-1.5 text-sm text-slate-500">
            <BookOpen className="h-4 w-4" />
            <span>{course.credits} 学分</span>
          </div>
          {course.semester && (
            <div className="flex items-center gap-1.5 text-sm text-slate-500">
              <Clock className="h-4 w-4" />
              <span>{course.semester}</span>
            </div>
          )}
          {course.department && (
            <div className="flex items-center gap-1.5 text-sm text-slate-500">
              <MapPin className="h-4 w-4" />
              <span>{course.department}</span>
            </div>
          )}
          {majorProgram && (
            <div className="flex items-center gap-1.5 text-sm text-slate-500">
              <Target className="h-4 w-4" />
              <span>建议第{majorProgram.suggestedSemester}学期修读</span>
            </div>
          )}
        </div>

        {course.description && (
          <p className="mt-3 text-sm leading-relaxed text-slate-500">
            {course.description}
          </p>
        )}
      </div>

      {/* ── Course guide preview cards ────────────────────── */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">课程学习指南</h2>
          <p className="mt-1 text-sm text-slate-500">
            每个模块默认展示内容预览，可单独或一次性展开。
          </p>
        </div>
        <button
          type="button"
          onClick={toggleAllSections}
          className="inline-flex min-h-9 items-center gap-1.5 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
        >
          {allSectionsExpanded ? "恢复预览" : "全部展开"}
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              allSectionsExpanded && "rotate-180",
            )}
          />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 1. 课程身份 */}
        <CourseSectionCard
          id="identity"
          icon={GraduationCap}
          title="课程身份"
          badge={
            isCompulsory ? (
              <Badge variant="compulsory">必修</Badge>
            ) : (
              <Badge variant="elective">选修</Badge>
            )
          }
          featured
          expanded={expandedSections.has("identity")}
          onToggle={toggleSection}
        >
          <div className="grid gap-y-2.5 rounded-lg bg-slate-50 p-4">
            <InfoRow label="课号" value={course.code} valueClassName="course-code" />
            <InfoRow label="课程名" value={course.name} />
            <InfoRow label="学分" value={`${course.credits} 学分`} />
            <InfoRow label="开课院系" value={course.department} />
            <InfoRow label="学期" value={course.semester} />
            <InfoRow label="类别" value={course.category} />
            {course.programs.length > 0 && (
              <div className="mt-2">
                <span className="text-xs text-slate-400">所属培养方案</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {course.programs.map((p, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                    >
                      {p.majorName} {p.year}级 · 第{p.suggestedSemester}学期
                      {p.isCompulsory ? " · 必修" : " · 选修"}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CourseSectionCard>

        {/* 2. 为什么学 */}
        <CourseSectionCard
          id="why"
          icon={HelpCircle}
          title="为什么学"
          expanded={expandedSections.has("why")}
          onToggle={toggleSection}
        >
          {/* Prerequisites */}
          <div className="mb-4">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <ArrowLeft className="h-3.5 w-3.5" />
              前置课程
            </h3>
            {course.prerequisites.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {course.prerequisites.map((p) => (
                  <CourseChip
                    key={p.code}
                    code={p.code}
                    name={p.name}
                    type="prerequisite"
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                message="该课程无前置依赖"
                icon={CheckCircle2}
              />
            )}
          </div>

          {/* Dependents */}
          <div className="mb-4">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <TrendingUp className="h-3.5 w-3.5" />
              后续课程
            </h3>
            {course.dependents.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {course.dependents.map((d) => (
                  <CourseChip
                    key={d.code}
                    code={d.code}
                    name={d.name}
                    type="dependent"
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                message="该课程暂无后续依赖课程"
                icon={Sparkles}
              />
            )}
          </div>

          {/* Common misconceptions */}
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              常见误区
            </h3>
            <ul className="space-y-2">
              {MOCK_MISCONCEPTIONS.map((m, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                  {m}
                </li>
              ))}
            </ul>
          </div>
        </CourseSectionCard>

        {/* 3. 课前预习 */}
        <CourseSectionCard
          id="preview"
          icon={BookMarked}
          title="课前预习"
          expanded={expandedSections.has("preview")}
          onToggle={toggleSection}
        >
          <div className="space-y-4">
            {/* Preview knowledge points */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                预习知识点
              </h3>
              <ul className="space-y-1.5">
                {MOCK_PREVIEW_POINTS.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>

            {/* Recommended materials */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                推荐资料
              </h3>
              <div className="space-y-1.5">
                {MOCK_PREVIEW_MATERIALS.map((m, i) => (
                  <a
                    key={i}
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-blue-600 transition hover:bg-blue-50"
                  >
                    <FileText className="h-4 w-4" />
                    {m.title}
                  </a>
                ))}
              </div>
            </div>

            {/* Estimated time */}
            <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
              <Clock className="h-5 w-5 text-slate-400" />
              <span className="text-sm text-slate-600">
                预计耗时：约 <strong>10-15 小时</strong>
              </span>
            </div>
          </div>
        </CourseSectionCard>

        {/* 4. 课中跟课 */}
        <CourseSectionCard
          id="during"
          icon={PenTool}
          title="课中跟课"
          expanded={expandedSections.has("during")}
          onToggle={toggleSection}
        >
          <div className="space-y-4">
            {/* Weekly rhythm */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                周节奏
              </h3>
              <div className="space-y-1.5">
                {MOCK_WEEKLY_RHYTHM.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-md border border-slate-200 px-4 py-2.5"
                  >
                    <span className="whitespace-nowrap rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {w.week}
                    </span>
                    <span className="text-sm text-slate-600">{w.focus}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Homework ratio */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                作业占比
              </h3>
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                {MOCK_HOMEWORK_RATIO}
              </div>
            </div>

            {/* Attendance */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                签到方式
              </h3>
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                {MOCK_ATTENDANCE}
              </div>
            </div>
          </div>
        </CourseSectionCard>

        {/* 5. 期末复习 */}
        <CourseSectionCard
          id="final"
          icon={Target}
          title="期末复习"
          expanded={expandedSections.has("final")}
          onToggle={toggleSection}
        >
          <div className="space-y-4">
            {/* Review route */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                复习路线
              </h3>
              <div className="space-y-2">
                {MOCK_REVIEW_ROUTE.map((step, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-md bg-blue-50 px-4 py-2.5"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="text-sm text-slate-700">{step}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Key chapters */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                重点章节
              </h3>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                        章节
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                        分值占比
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                        说明
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {MOCK_KEY_CHAPTERS.map((c, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-4 py-2.5 font-medium text-slate-700">
                          {c.chapter}
                        </td>
                        <td className="px-4 py-2.5 text-blue-600">
                          {c.weight}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {c.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Exam clues */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                真题线索
              </h3>
              <ul className="space-y-1.5">
                {MOCK_EXAM_CLUES.map((clue, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    {clue}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CourseSectionCard>

        {/* 6. 老师评价 */}
        <CourseSectionCard
          id="teachers"
          icon={Users}
          title="老师评价"
          expanded={expandedSections.has("teachers")}
          onToggle={toggleSection}
        >
          <div className="space-y-3">
            {MOCK_TEACHERS.map((t, i) => (
              <div
                key={i}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4"
              >
                <h4 className="text-sm font-semibold text-slate-800">
                  {t.name}
                </h4>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                  <span className="text-slate-500">
                    风格：<span className="text-slate-700">{t.style}</span>
                  </span>
                  <span className="text-slate-500">
                    给分：<span className="text-slate-700">{t.scoring}</span>
                  </span>
                  <span className="text-slate-500">
                    作业量：<span className="text-slate-700">{t.workload}</span>
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  {t.comment}
                </p>
              </div>
            ))}
          </div>
        </CourseSectionCard>

        {/* 7. 资源区 */}
        <CourseSectionCard
          id="resources"
          icon={FileText}
          title="资源区"
          expanded={expandedSections.has("resources")}
          onToggle={toggleSection}
        >
          <ResourceSection courseCode={course.code} courseName={course.name} />
        </CourseSectionCard>

        {/* 8. 图谱区 */}
        <CourseSectionCard
          id="graph"
          icon={GitFork}
          title="图谱区"
          expanded={expandedSections.has("graph")}
          onToggle={toggleSection}
        >
          <div className="space-y-2">
            {/* Current course (root) */}
            <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-3">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-blue-600" />
                <span className="course-code text-sm font-semibold text-blue-800">
                  {course.code}
                </span>
                <span className="text-xs text-blue-600">{course.name}</span>
                <span className="ml-auto rounded-full bg-blue-200 px-2 py-0.5 text-xs font-medium text-blue-700">
                  当前
                </span>
              </div>
            </div>

            {/* Prerequisites branch */}
            {course.prerequisites.length > 0 && (
              <div className="ml-4 border-l-2 border-dashed border-slate-200 pl-4">
                <div className="mb-1.5 text-xs font-medium text-slate-400">
                  先修课程
                </div>
                {course.prerequisites.map((p) => (
                  <Link
                    key={p.code}
                    href={`/course/${p.code}`}
                    className="mb-1.5 flex items-center gap-2 rounded-md border border-green-200 bg-green-50/50 px-3 py-2 transition hover:bg-green-100"
                  >
                    <span className="course-code text-sm font-medium text-green-700">
                      {p.code}
                    </span>
                    <span className="text-xs text-green-600">{p.name}</span>
                    {p.reason && (
                      <span className="ml-auto text-xs text-green-500">
                        {p.reason}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}

            {/* Dependents branch */}
            {course.dependents.length > 0 && (
              <div className="ml-4 border-l-2 border-dashed border-slate-200 pl-4">
                <div className="mb-1.5 text-xs font-medium text-slate-400">
                  后续课程
                </div>
                {course.dependents.map((d) => (
                  <Link
                    key={d.code}
                    href={`/course/${d.code}`}
                    className="mb-1.5 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2 transition hover:bg-blue-100"
                  >
                    <span className="course-code text-sm font-medium text-blue-700">
                      {d.code}
                    </span>
                    <span className="text-xs text-blue-600">{d.name}</span>
                    {d.reason && (
                      <span className="ml-auto text-xs text-blue-500">
                        {d.reason}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}

            {/* Empty state for graph */}
            {course.prerequisites.length === 0 &&
              course.dependents.length === 0 && (
                <EmptyState
                  message="该课程暂无依赖关系图谱"
                  icon={GitFork}
                />
              )}
          </div>
        </CourseSectionCard>
      </div>
    </main>
  );
}

// ─── 资源区子组件 ──────────────────────────────
function ResourceSection({ courseCode, courseName }: { courseCode: string; courseName: string }) {
  const { data: resources = [], isLoading, isError } = useQuery({
    queryKey: ["course-resources", courseCode],
    queryFn: () =>
      api.get<{ id: string; title: string; type: string; url: string | null; summary: string | null; applicableStage: string | null; submitterName: string }[]>(
        `/api/courses/${courseCode}/resources`,
      ),
  });

  return (
    <div className="space-y-3">
      {/* CC98 Jump */}
      <a
        href={`https://www.cc98.org/search?q=${encodeURIComponent(courseName)}`}
        target="_blank" rel="noopener noreferrer"
        className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-4 transition hover:bg-blue-100">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
            <ExternalLink className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-blue-800">在 CC98 搜索「{courseName}」</p>
            <p className="text-xs text-blue-500">查看论坛讨论、真题回忆、经验分享</p>
          </div>
        </div>
        <ChevronDown className="h-5 w-5 -rotate-90 text-blue-400" />
      </a>

      {/* Approved resources */}
      {isLoading && <div className="py-4 text-center text-sm text-slate-400">加载中...</div>}

      {isError && <div className="py-4 text-center text-sm text-red-500">资源加载失败</div>}

      {!isLoading && !isError && resources.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center">
          <BookMarked className="mx-auto mb-2 h-6 w-6 text-slate-300" />
          <p className="text-sm text-slate-400">暂无已审核资源，去
            <a href="/contribute" className="mx-1 text-blue-500 hover:underline">投稿</a>
          贡献第一个</p>
        </div>
      )}

      {resources.map((r) => (
        <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
              ✅ 已审核
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
              {RESOURCE_TYPE_LABELS[r.type] ?? r.type}
            </span>
            {r.applicableStage && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">
                {APPLICABLE_STAGE_LABELS[r.applicableStage] ?? r.applicableStage}
              </span>
            )}
          </div>
          <h4 className="font-medium text-slate-900">{r.title}</h4>
          {r.summary && <p className="mt-1 text-sm text-slate-500">{r.summary}</p>}
          <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
            <span>贡献者：{r.submitterName}</span>
            {r.url && (
              <a href={r.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-500 hover:underline">
                <ExternalLink className="h-3 w-3" />查看原文
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
