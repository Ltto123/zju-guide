"use client";

import { useEffect, useRef, useState, useMemo, type ComponentType, type SVGProps } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Search, Check, Compass, ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import {
  GeneralEducationIcon,
  MajorFoundationIcon,
  MajorCoreIcon,
  MajorModuleIcon,
} from "@/components/course-category-icons";

// ─── 类型 ────────────────────────────────────────
interface CourseData {
  code: string; name: string; credits: number;
  category: string; semester: string;
  department?: string;
  prerequisites: { code: string; name: string }[];
  dependents: { code: string; name: string }[];
}

interface ProgramOption {
  id: string;
  majorName: string;
  year: number;
  totalCredits: number;
}

interface ProgramCatalog {
  years: { year: number; majors: string[] }[];
  options: ProgramOption[];
  total: number;
}

interface UserProgramData {
  id: string;
  type: "MAJOR" | "MINOR";
  programVersion: ProgramOption;
}

// ─── 常亮 ────────────────────────────────────────
interface CourseGroup {
  key: string;
  label: string;
  bar: string;
  dot: string;
  border: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  iconColor?: string;
  emoji?: string;
}

const GROUPS: CourseGroup[] = [
  { key: "gen_ed", label: "通识基础", icon: GeneralEducationIcon, iconColor: "text-blue-600", bar: "bg-blue-500", dot: "bg-blue-500", border: "border-l-blue-500" },
  { key: "major_base", label: "专业基础", icon: MajorFoundationIcon, iconColor: "text-cyan-600", bar: "bg-cyan-500", dot: "bg-cyan-500", border: "border-l-cyan-500" },
  { key: "major_core", label: "专业核心", icon: MajorCoreIcon, iconColor: "text-amber-600", bar: "bg-amber-500", dot: "bg-amber-500", border: "border-l-amber-500" },
  { key: "major_practice", label: "实验实践", emoji: "🔬", bar: "bg-teal-500", dot: "bg-teal-500", border: "border-l-teal-500" },
  { key: "major_module", label: "专业模块选修", icon: MajorModuleIcon, iconColor: "text-emerald-600", bar: "bg-emerald-500", dot: "bg-emerald-500", border: "border-l-emerald-500" },
  { key: "personalized", label: "个性修读", emoji: "🎯", bar: "bg-blue-500", dot: "bg-blue-500", border: "border-l-blue-500" },
];

const SEMESTERS = ["大一上","大一下","大一暑","大二上","大二下","大二暑","大三上","大三下","大四上","大四下"];

const programLabel = (program: ProgramOption) => `${program.majorName} · ${program.year}级`;

function ProgramCombobox({
  label,
  value,
  options,
  placeholder,
  onChange,
  onRemove,
}: {
  label: string;
  value: string;
  options: ProgramOption[];
  placeholder: string;
  onChange: (value: string) => void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasExactSelection = options.some((program) => programLabel(program) === value);
  const filteredOptions = value && !hasExactSelection
    ? options.filter((program) =>
        programLabel(program).toLowerCase().includes(value.toLowerCase()),
      )
    : options;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  return (
    <div className="block" ref={rootRef}>
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
      <div className="relative">
        <input
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown") setOpen(true);
          }}
          placeholder={placeholder}
          className={`h-10 w-full border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
            onRemove ? "pr-20" : "pr-10"
          }`}
        />
        <button
          type="button"
          aria-label={open ? `收起${label}选项` : `展开${label}选项`}
          onClick={() => setOpen((current) => !current)}
          className={`absolute top-0 flex h-10 w-10 items-center justify-center text-slate-400 transition hover:text-blue-700 ${
            onRemove ? "right-10" : "right-0"
          }`}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {onRemove && (
          <button
            type="button"
            aria-label={`移除${label}`}
            onClick={onRemove}
            className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {open && (
          <div
            role="listbox"
            className="absolute inset-x-0 top-[calc(100%+7px)] z-30 max-h-64 overflow-y-auto border border-blue-200 bg-white p-1.5 shadow-[0_18px_42px_rgb(15_23_42_/_0.16)]"
          >
            <span
              aria-hidden="true"
              className="absolute -top-1.5 left-6 h-3 w-3 rotate-45 border-l border-t border-blue-200 bg-white"
            />
            {filteredOptions.length > 0 ? (
              filteredOptions.map((program) => {
                const optionValue = programLabel(program);
                const selected = optionValue === value;
                return (
                  <button
                    key={program.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(optionValue);
                      setOpen(false);
                    }}
                    className={`relative flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition ${
                      selected
                        ? "bg-blue-50 font-semibold text-blue-800"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        selected
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-300 text-transparent"
                      }`}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                    <span>{optionValue}</span>
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-5 text-center text-sm text-slate-400">没有匹配的专业</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 分类映射 ────────────────────────────────────
function getCatKey(c: CourseData): string {
  if (c.category.startsWith("module_")) return "major_module";
  if (c.category === "major_practice") return "major_practice";
  return c.category;
}

// ─── 主页面 ──────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [passed, setPassed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"map" | "timeline">("map");
  const [hovered, setHovered] = useState<string | null>(null);
  const [majorInput, setMajorInput] = useState("");
  const [minorInputs, setMinorInputs] = useState<string[]>([]);
  const [programsInitialized, setProgramsInitialized] = useState(false);
  const [programError, setProgramError] = useState("");

  const { data: programCatalog } = useQuery<ProgramCatalog>({
    queryKey: ["programs"],
    queryFn: () => api.get("/api/programs"),
  });

  const { data: userPrograms, isLoading: userProgramsLoading } = useQuery<UserProgramData[]>({
    queryKey: ["my-programs"],
    queryFn: () => api.get("/api/me/programs"),
  });

  const programOptions = programCatalog?.options ?? [];
  const appliedProgramIds = useMemo(
    () => (userPrograms ?? []).map((program) => program.programVersion.id),
    [userPrograms],
  );

  useEffect(() => {
    if (programsInitialized || !userPrograms) return;
    const major = userPrograms.find((program) => program.type === "MAJOR");
    const minors = userPrograms
      .filter((program) => program.type === "MINOR")
      .slice(0, 3);
    setMajorInput(major ? programLabel(major.programVersion) : "");
    setMinorInputs(minors.map((program) => programLabel(program.programVersion)));
    setProgramsInitialized(true);
  }, [programsInitialized, userPrograms]);

  const { data: allCourses = [], isLoading: coursesLoading, isError } = useQuery<CourseData[]>({
    queryKey: ["all-courses", appliedProgramIds],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: "500" });
      for (const id of appliedProgramIds) params.append("programVersionId", id);
      return api.rawGet<{ data: CourseData[] }>(`/api/courses?${params.toString()}`).then((d) => d.data ?? []);
    },
    enabled: appliedProgramIds.length > 0,
  });

  const updatePrograms = useMutation({
    mutationFn: (selection: { majorProgramVersionId: string; minorProgramVersionIds: string[] }) =>
      api.put<UserProgramData[]>("/api/me/programs", selection),
    onSuccess: async () => {
      setProgramError("");
      await queryClient.invalidateQueries({ queryKey: ["my-programs"] });
    },
  });

  const isLoading = userProgramsLoading || coursesLoading;

  const filtered = useMemo(() => {
    return allCourses.filter((c) => {
      const ms = !search || c.name.includes(search) || c.code.toLowerCase().includes(search.toLowerCase());
      const mf = filter === "all" || getCatKey(c) === filter;
      return ms && mf;
    });
  }, [allCourses, search, filter]);

  const isHL = (c: CourseData) => {
    if (!hovered || hovered === c.code) return true;
    return c.prerequisites?.some((p) => p.code === hovered) || c.dependents?.some((d) => d.code === hovered);
  };

  const credits = useMemo(() => {
    const s: Record<string, { earned: number; total: number }> = {};
    for (const g of GROUPS) s[g.key] = { earned: 0, total: 0 };
    for (const c of allCourses) {
      const k = getCatKey(c);
      if (s[k]) { s[k]!.total += c.credits; if (passed.has(c.code)) s[k]!.earned += c.credits; }
    }
    const totalE = Object.values(s).reduce((a, v) => a + v.earned, 0);
    const totalC = Object.values(s).reduce((a, v) => a + v.total, 0);
    return { groups: s, totalEarned: totalE, totalCredits: totalC };
  }, [allCourses, passed]);

  const toggle = (code: string) => setPassed((p) => {
    const n = new Set(p); n.has(code) ? n.delete(code) : n.add(code); return n;
  });

  const applyProgramSelection = () => {
    const major = programOptions.find((program) => programLabel(program) === majorInput);
    const minors = minorInputs.map((input) =>
      programOptions.find((program) => programLabel(program) === input),
    );

    if (!major) {
      setProgramError("请从候选列表中选择一个主修专业");
      return;
    }
    if (minors.some((program) => !program)) {
      setProgramError("请从候选列表中完成辅修专业选择");
      return;
    }

    const minorIds = minors
      .filter((program): program is ProgramOption => Boolean(program))
      .map((program) => program.id);
    if (new Set([major.id, ...minorIds]).size !== minorIds.length + 1) {
      setProgramError("主修与辅修专业不能重复");
      return;
    }

    setProgramError("");
    updatePrograms.mutate({
      majorProgramVersionId: major.id,
      minorProgramVersionIds: minorIds,
    });
  };

  return (
    <div className="dashboard-home space-y-5">
      {/* ── 学分总览条 ── */}
      <div className="credit-overview border border-slate-200 bg-white p-5 lg:p-6">
        <div className="program-selector mb-6 p-4 lg:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">专业组合</h2>
              <p className="mt-1 text-xs text-slate-500">选择一个主修专业，可添加至多三个辅修专业</p>
            </div>
            <button
              type="button"
              onClick={applyProgramSelection}
              disabled={updatePrograms.isPending || !majorInput}
              className="geometry-button min-h-9 px-4 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {updatePrograms.isPending ? "应用中..." : "应用专业组合"}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ProgramCombobox
              label="主修专业"
              value={majorInput}
              options={programOptions}
              placeholder="输入并选择主修专业"
              onChange={setMajorInput}
            />

            {minorInputs.map((minor, index) => (
              <ProgramCombobox
                key={index}
                label={`辅修专业 ${index + 1}`}
                value={minor}
                options={programOptions}
                placeholder="输入并选择辅修专业"
                onChange={(nextValue) => setMinorInputs((current) =>
                  current.map((currentValue, itemIndex) => itemIndex === index ? nextValue : currentValue)
                )}
                onRemove={() => setMinorInputs((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index)
                )}
              />
            ))}

            {minorInputs.length < 3 && (
              <button
                type="button"
                onClick={() => setMinorInputs((current) => [...current, ""])}
                className="mt-[22px] flex h-10 items-center justify-center gap-1.5 border border-dashed border-blue-300 bg-blue-50/60 px-3 text-sm font-semibold text-blue-700 transition hover:border-blue-500 hover:bg-blue-100"
              >
                <Plus className="h-4 w-4" />
                添加辅修专业
              </button>
            )}
          </div>

          {(programError || updatePrograms.error) && (
            <p className="mt-3 text-xs font-medium text-red-600">
              {programError || (updatePrograms.error as Error).message}
            </p>
          )}
        </div>

        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2.5 text-sm font-semibold text-slate-800">
            <Compass className="h-5 w-5 text-blue-600" />毕业学分进度
          </h2>
          <span className="text-sm font-bold tabular-nums text-blue-700">
            {credits.totalEarned.toFixed(1)} / {credits.totalCredits.toFixed(1)}
          </span>
        </div>
        <div className="mb-5 h-1.5 overflow-hidden bg-slate-100">
          <div className="h-full bg-blue-600 transition-all"
            style={{ width: `${Math.min(100, (credits.totalEarned / (credits.totalCredits || 1)) * 100)}%` }} />
        </div>
        <div className="credit-category-grid grid grid-cols-2 gap-px overflow-hidden border border-slate-200 bg-slate-200 sm:grid-cols-3 xl:grid-cols-6">
          {GROUPS.map((g) => {
            const s = credits.groups[g.key]!;
            const pct = Math.min(100, (s.earned / (s.total || 1)) * 100);
            const GroupIcon = g.icon;
            return (
              <button key={g.key} onClick={() => setFilter(filter === g.key ? "all" : g.key)}
                className={`credit-category min-h-[72px] bg-white p-3 text-left text-xs transition ${filter === g.key ? "is-active" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-medium text-slate-600">
                    {GroupIcon ? (
                      <GroupIcon className={`h-4 w-4 shrink-0 ${g.iconColor}`} />
                    ) : (
                      <span aria-hidden="true">{g.emoji}</span>
                    )}
                    {g.label}
                  </span>
                  <span className="tabular-nums text-slate-400">{s.earned}/{s.total}</span>
                </div>
                <div className="mt-3 h-1 overflow-hidden bg-slate-100">
                  <div className={`h-full ${g.bar} transition-all`} style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 搜索栏 ── */}
      <div className="course-toolbar flex flex-wrap items-center gap-3 border border-slate-200 bg-white p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索课程名称或课号..." className="course-search h-10 w-full border-0 bg-transparent py-2 pl-10 pr-4 text-sm focus:outline-none" />
        </div>
        <div className="view-switch flex border border-slate-200 bg-slate-50 p-0.5">
          {[{ k: "map", l: "修读导图" }, { k: "timeline", l: "学期时间线" }].map((v) => (
            <button key={v.k} onClick={() => setView(v.k as "map" | "timeline")}
              className={`min-h-9 px-4 text-xs font-medium transition ${view === v.k ? "is-active" : "text-slate-500 hover:bg-white hover:text-slate-800"}`}>
              <span>{v.l}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 课程区域 ── */}
      {isLoading && (
        <div className="py-16 text-center text-sm text-slate-400">加载课程数据中...</div>
      )}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">加载课程失败，请刷新重试</div>
      )}
      {!isLoading && !isError && (
      <>
      {view === "map" ? (
        <div className="space-y-8">
          {GROUPS.map((g) => {
            const items = filtered.filter((c) => getCatKey(c) === g.key);
            if (items.length === 0) return null;
            const GroupIcon = g.icon;
            return (
              <div key={g.key} className={`course-group relative border border-l-4 border-slate-200 ${g.border} bg-white px-4 py-4 lg:px-5`}>
                <span className={`absolute -left-[9px] top-5 h-3.5 w-3.5 ${g.dot} border-[3px] border-white`} />
                <h3 className="mb-5 flex items-center gap-3 text-xl font-bold tracking-tight text-slate-800">
                  {GroupIcon ? (
                    <GroupIcon className={`h-7 w-7 shrink-0 ${g.iconColor}`} />
                  ) : (
                    <span className="text-[26px]" aria-hidden="true">{g.emoji}</span>
                  )}
                  {g.label}
                  <span className="ml-1 text-base font-normal text-slate-400">({items.length}门)</span>
                </h3>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {items.map((c) => (
                    <Card key={c.code} c={c} passed={passed.has(c.code)} hl={isHL(c)}
                      onClick={() => router.push(`/course/${c.code}`)}
                      onToggle={() => toggle(c.code)}
                      onEnter={() => setHovered(c.code)} onLeave={() => setHovered(null)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-6">
          {SEMESTERS.map((sem) => {
            const items = filtered.filter((c) => c.semester === sem);
            if (items.length === 0) return null;
            return (
              <div key={sem} className="relative border-l-2 border-slate-200 pl-6">
                <div className="absolute -left-[7px] top-1.5 flex h-3 w-3 items-center justify-center rounded-full border-2 border-blue-400 bg-white" />
                <h4 className="mb-3 text-sm font-bold text-slate-700">{sem}</h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((c) => (
                    <Card key={c.code} c={c} passed={passed.has(c.code)} hl={isHL(c)}
                      onClick={() => router.push(`/course/${c.code}`)}
                      onToggle={() => toggle(c.code)}
                      onEnter={() => setHovered(c.code)} onLeave={() => setHovered(null)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ─── 课程卡片 ────────────────────────────────────
function Card({ c, passed, hl, onClick, onToggle, onEnter, onLeave }: {
  c: CourseData; passed: boolean; hl: boolean;
  onClick: () => void; onToggle: () => void;
  onEnter: () => void; onLeave: () => void;
}) {
  const catColors: Record<string, string> = {
    gen_ed: "border-blue-200 bg-blue-50/30 text-blue-700",
    major_base: "border-cyan-200 bg-cyan-50/30 text-cyan-700",
    major_core: "border-amber-200 bg-amber-50/30 text-amber-700",
    major_practice: "border-teal-200 bg-teal-50/30 text-teal-700",
    major_module: "border-emerald-200 bg-emerald-50/30 text-emerald-700",
    personalized: "border-blue-200 bg-blue-50/30 text-blue-700",
  };
  const catKey = c.category.startsWith("module_") ? "major_module" : c.category;
  const cc = catColors[catKey] ?? "border-slate-200 bg-white";

  return (
    <div onClick={onClick} onMouseEnter={onEnter} onMouseLeave={onLeave}
      className={`course-card group relative cursor-pointer border bg-white p-3.5 transition-all duration-150 ${passed ? "is-passed ring-1 ring-emerald-300" : ""} ${hl ? "opacity-100" : "opacity-40"}`}>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <h5 className="truncate text-[15px] font-semibold text-slate-800" title={c.name}>{c.name}</h5>
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className={`course-check flex h-5 w-5 shrink-0 items-center justify-center border transition ${passed ? "border-emerald-400 bg-emerald-100 text-emerald-600" : "border-slate-300 text-transparent hover:border-slate-400"}`}>
          <Check className="h-2.5 w-2.5" />
        </button>
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="course-code text-slate-400">{c.code}</span>
        <span className="flex items-center gap-1 font-medium text-slate-500">
          {c.credits}学分 <ChevronRight className="h-3 w-3 text-slate-300" />
        </span>
      </div>
      {(c.prerequisites?.length ?? 0) > 0 && (
        <div className="pointer-events-none absolute right-2 top-[-7px] scale-0 bg-slate-900 px-2 py-1 text-[10px] text-white shadow-lg transition group-hover:scale-100">
          前置: {c.prerequisites.map((p, index) => (
            <span key={p.code} className="course-code">
              {index > 0 ? ", " : ""}{p.code}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
