"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ArrowLeft, Shield } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api-client";
import type { CourseOccurrence } from "@/lib/course-correction-document";
import type { CorrectionInput, correctCourse } from "@/lib/course-correction";

type Preview = Awaited<ReturnType<typeof correctCourse>>;
type Program = { id: string; majorName: string; year: number; isActive: boolean };
type Details = NonNullable<CorrectionInput["details"]>;
type Selection = { code: string; name: string; details: Details };
const endpoint = "/api/admin/course-corrections";
const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const buttonClass = "rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";

export default function CourseCorrectionsPage() {
  const { user, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"program" | "search">("program");
  const [programId, setProgramId] = useState("");
  const [programSearch, setProgramSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [targetCode, setTargetCode] = useState("");
  const [targetName, setTargetName] = useState("");
  const [details, setDetails] = useState<Details>({ credits: 0, department: "", category: "", description: "", semester: "" });
  const [scope, setScope] = useState<CorrectionInput["scope"]>("selected");
  const [existingAction, setExistingAction] = useState<CorrectionInput["existingAction"]>();
  const [transfer, setTransfer] = useState<"independent" | "migrate">("independent");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savedCode, setSavedCode] = useState("");
  const enabled = user?.role === "ADMIN";
  const programs = useQuery({ queryKey: ["correction-programs"], queryFn: () => api.get<Program[]>(endpoint), enabled });
  const program = useQuery({ queryKey: ["correction-program", programId], queryFn: () => api.get<Program & { totalCredits: number; courses: (CourseOccurrence & { details: Details })[] }>(`${endpoint}?programId=${programId}`), enabled: enabled && mode === "program" && !!programId });
  const results = useQuery({ queryKey: ["correction-search", query, page], queryFn: () => api.get<{ courses: ({ code: string; name: string; credits: number; department: string | null; category: string | null; description: string | null; semester: string | null })[]; total: number; pageSize: number }>(`${endpoint}?search=${encodeURIComponent(query)}&page=${page}`), enabled: enabled && mode === "search" && !!query });
  const codeChanged = !!selected && selected.code !== targetCode.trim();
  const targetQuery = useQuery({ queryKey: ["correction-target", targetCode.trim()], queryFn: () => api.get<{ course: ({ code: string; name: string; credits: number; department: string | null; category: string | null; description: string | null; semester: string | null }) | null }>(`${endpoint}?exactCode=${encodeURIComponent(targetCode.trim())}`), enabled: enabled && codeChanged && !!targetCode.trim() });
  const existing = codeChanged ? targetQuery.data?.course : null;
  const displayedDetails = existing ? { credits: existing.credits, department: existing.department ?? "", category: existing.category ?? "", description: existing.description ?? "", semester: existing.semester ?? "" } : details;
  useEffect(() => { setExistingAction(undefined); setPreview(null); }, [targetCode]);

  function reset() { setSelected(null); setPreview(null); setError(""); setSuccess(""); }
  function select(course: Selection) {
    setSelected(course); setTargetCode(course.code); setTargetName(course.name);
    setDetails(course.details);
    setScope(mode === "search" ? "all" : "selected"); setTransfer("independent"); setPreview(null); setError(""); setSuccess("");
  }
  async function submit(action: "preview" | "apply") {
    if (!selected) return;
    setBusy(true); setError(""); setSuccess("");
    const body: CorrectionInput = { mode, ...(mode === "program" ? { programId } : {}), sourceCode: selected.code, sourceName: selected.name, targetCode, targetName: existing?.name ?? targetName, ...(!existing && (codeChanged || scope === "all") ? { details } : {}), ...(existing ? { existingAction } : {}), scope, transfer, action, fingerprint: preview?.fingerprint };
    try {
      const data = await api.post<Preview>(endpoint, body);
      if (action === "preview") setPreview(data);
      else {
        setSuccess(`已将 ${selected.code} ${selected.name} 修正为 ${data.targetCode} ${data.targetName}，更新 ${data.programs.length} 个培养方案，课程库已同步。`);
        setSavedCode(data.targetCode);
        setSelected(null); setPreview(null);
        await queryClient.invalidateQueries();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); setPreview(null); }
    finally { setBusy(false); }
  }

  if (isLoading) return <p className="p-8">正在加载…</p>;
  if (!enabled) return <div className="p-8 text-center"><Shield className="mx-auto mb-3" /><p>仅管理员可访问此页面</p><Link href="/">返回仪表盘</Link></div>;
  const visibleCourses = program.data?.courses.filter(c => `${c.courseCode} ${c.courseName} ${c.path.join(" ")}`.toLowerCase().includes(filter.toLowerCase())) ?? [];
  const queryError = programs.error || (mode === "program" ? program.error : results.error);
  const visiblePrograms = programs.data?.filter(p => p.id === programId || `${p.year} ${p.majorName}`.toLowerCase().includes(programSearch.trim().toLowerCase()));

  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
    <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-500"><ArrowLeft className="h-4 w-4" />返回仪表盘</Link>
    <header><h1 className="flex items-center gap-3 text-2xl font-bold"><BookOpen className="text-blue-600" />课程修正</h1><p className="mt-2 text-sm text-slate-500">选择课程、修改课号或名称，并核对培养方案与关联数据的迁移范围。</p></header>
    {success && <div role="status" className="rounded-lg bg-green-50 p-4 text-green-800"><p>{success}</p><Link href={`/courses?search=${encodeURIComponent(savedCode)}`} className="mt-2 inline-block text-sm underline">在课程库中查看</Link></div>}
    <fieldset disabled={busy} className="space-y-6 disabled:opacity-70">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">1. 定位课程</h2>
        <div className="flex flex-wrap gap-3">{([['program', '从培养方案中选择'], ['search', '按课号或名称搜索']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); reset(); }} className={`rounded-lg border px-4 py-2 text-sm ${mode === value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200"}`}>{label}</button>)}</div>
        {mode === "program" ? <>
          <label className="block space-y-2 text-sm"><span>搜索培养方案</span><input value={programSearch} onChange={e => setProgramSearch(e.target.value)} placeholder="输入专业名称或年份" className={inputClass} /></label>
          <label className="block space-y-2 text-sm"><span>培养方案</span><select value={programId} onChange={e => { setProgramId(e.target.value); setFilter(""); reset(); }} className={inputClass}><option value="">请选择培养方案</option>{visiblePrograms?.map(p => <option key={p.id} value={p.id}>{p.year} · {p.majorName}{p.isActive ? "" : "（未启用）"}</option>)}</select></label>
          {programs.data && !visiblePrograms?.length && <p className="text-sm text-slate-500">没有匹配的培养方案</p>}
          {program.isFetching && <p className="text-sm text-slate-500">加载培养方案预览…</p>}
          {program.data && <>
            <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{program.data.year} · {program.data.majorName} <span className="text-sm font-normal text-slate-500">{program.data.totalCredits} 学分</span></h3><input aria-label="筛选方案内课程" placeholder="筛选课号、名称或模块" value={filter} onChange={e => setFilter(e.target.value)} className={`${inputClass} sm:!w-72`} /></div>
            <div className="grid max-h-[520px] gap-3 overflow-y-auto p-1 md:grid-cols-2">{visibleCourses.map((c, index) => <button type="button" key={`${c.courseCode}-${index}`} onClick={() => select({ code: c.courseCode, name: c.courseName, details: c.details })} aria-pressed={selected?.code === c.courseCode} className={`rounded-lg border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${selected?.code === c.courseCode ? "border-blue-500 bg-blue-50" : "border-slate-200"}`}><span className="block text-xs text-slate-500">{c.path.join(" › ")}</span><span className="mt-2 block font-semibold">{c.courseName}</span><span className="mt-1 block text-sm text-slate-500">{c.courseCode} · {c.credits} 学分{c.semesters.length ? ` · ${c.semesters.map(s => s.rawLabel).join("、")}` : ""}</span></button>)}</div>
            {!visibleCourses.length && <p className="text-sm text-slate-500">未找到课程</p>}
          </>}
        </> : <>
          <form onSubmit={e => { e.preventDefault(); setQuery(search.trim()); setPage(1); reset(); }} className="flex gap-3"><input aria-label="课程名或课号" required maxLength={100} value={search} onChange={e => setSearch(e.target.value)} placeholder="输入课程名或课号，如 MATH1135G" className={inputClass} /><button className={`${buttonClass} shrink-0`}>搜索</button></form>
          {results.isFetching && <p className="text-sm text-slate-500">搜索中…</p>}
          <div className="grid gap-3 md:grid-cols-2">{results.data?.courses.map(c => <button type="button" key={c.code} aria-pressed={selected?.code === c.code} onClick={() => select({ code: c.code, name: c.name, details: { credits: c.credits, department: c.department ?? "", category: c.category ?? "", description: c.description ?? "", semester: c.semester ?? "" } })} className={`rounded-lg border p-4 text-left ${selected?.code === c.code ? "border-blue-500 bg-blue-50" : "border-slate-200"}`}><span className="block font-semibold">{c.name}</span><span className="text-sm text-slate-500">{c.code} · {c.credits} 学分</span></button>)}</div>
          {results.data && <div className="flex items-center gap-4 text-sm"><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className="disabled:opacity-40">上一页</button><span>第 {page} 页 · 共 {results.data.total} 门课程</span><button type="button" disabled={page * results.data.pageSize >= results.data.total} onClick={() => setPage(page + 1)} className="disabled:opacity-40">下一页</button></div>}
        </>}
        {queryError && <p role="alert" className="text-red-600">{queryError.message}</p>}
      </section>
      {selected && <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5" onChange={() => setPreview(null)}>
        <h2 className="font-semibold">2. 修改课程</h2><p className="text-sm text-slate-500">已锁定：{selected.code} · {selected.name}</p>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm"><span>新课号</span><input value={targetCode} maxLength={100} onChange={e => setTargetCode(e.target.value)} className={inputClass} /></label><label className="space-y-2 text-sm"><span>新课程名称</span><input value={existing?.name ?? targetName} disabled={!!existing} maxLength={200} onChange={e => setTargetName(e.target.value)} className={inputClass} /></label></div>
        {codeChanged && targetQuery.isFetching && <p className="text-sm text-slate-500">正在检查课号是否已存在…</p>}
        {codeChanged && targetQuery.error && <p role="alert" className="text-sm text-red-600">课号检查失败：{targetQuery.error.message}</p>}
        <label className="block space-y-2 text-sm"><span>生效范围（按选中课程的原信息精确匹配）</span><select value={scope} onChange={e => setScope(e.target.value as CorrectionInput["scope"])} className={inputClass}>
          {mode === "program" && <option value="selected">仅当前培养方案中的原课号（默认）</option>}
          <option value="all">所有培养方案：课号与原课号一致</option>
          <option value="name">所有培养方案：课程名与原课程名一致</option>
          <option value="both">所有培养方案：课号和课程名均与原信息一致</option>
        </select></label>
        {existing ? <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm">
          <p className="font-semibold">课号已存在：{existing.code} · {existing.name}。是否并入此课程？</p>
          <p>课程名称、学分及其他信息已锁定为目标课程。请选择并入方式，然后预览并确认：</p>
          <label className="flex items-start gap-2"><input type="radio" name="existingAction" checked={existingAction === "merge_resources"} onChange={() => setExistingAction("merge_resources")} /><span>合并资源：将所有匹配课号的资源追加到目标课程，再替换培养方案引用。重复资源只关联一次，原课号不再关联这些资源。</span></label>
          <label className="flex items-start gap-2"><input type="radio" name="existingAction" checked={existingAction === "replace"} onChange={() => setExistingAction("replace")} /><span>仅替换课程：直接使用已有课程取代匹配课程，原课程资源保留，不迁移。</span></label>
          <p>这两种方式均保留目标课程现有信息；修课记录、教师及先修关系不并入。</p>
        </div> : codeChanged ? <div className="space-y-3 text-sm"><label className="flex items-start gap-2"><input type="radio" name="transfer" checked={transfer === "independent"} onChange={() => setTransfer("independent")} /><span>新建独立课程：默认复制选中课程的非资源内容；投稿资源及附件仍留在原课程。</span></label><label className="flex items-start gap-2"><input type="radio" name="transfer" checked={transfer === "migrate"} onChange={() => setTransfer("migrate")} /><span>完整迁移：将匹配课程的资源以及选中课程的修课记录、教师关联、先修关系和期末复习内容转移到新课程。</span></label>{transfer === "migrate" && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">资源迁移作用于整个课号，即使部分培养方案仍保留原课号，原课号也不再关联已迁移资源。</p>}</div> : <p className="text-sm text-slate-500">课号不变时不新建课程，按所选范围更新显示名称。</p>}
        <fieldset disabled={!!existing || (!codeChanged && scope !== "all")} className="grid gap-4 sm:grid-cols-2 disabled:opacity-50">
          <label className="space-y-2 text-sm"><span>学分</span><input type="number" min="0" max="100" step="0.1" value={displayedDetails.credits} onChange={e => setDetails({ ...details, credits: e.target.valueAsNumber })} className={inputClass} /></label>
          {([['department', '开课学院'], ['category', '课程分类'], ['semester', '开课学期']] as const).map(([key, label]) => <label key={key} className="space-y-2 text-sm"><span>{label}</span><input value={displayedDetails[key]} maxLength={key === "department" ? 200 : 100} onChange={e => setDetails({ ...details, [key]: e.target.value })} className={inputClass} /></label>)}
          <label className="space-y-2 text-sm sm:col-span-2"><span>课程简介</span><textarea rows={3} maxLength={10000} value={displayedDetails.description} onChange={e => setDetails({ ...details, description: e.target.value })} className={inputClass} /></label>
        </fieldset>
        {!codeChanged && scope !== "all" && <p className="text-sm text-slate-500">修改公共课程信息，请选择“所有培养方案：课号与原课号一致”，或填写新课号。</p>}
        <button type="button" className={buttonClass} disabled={!targetCode.trim() || !(existing?.name ?? targetName).trim() || !Number.isFinite(displayedDetails.credits) || (codeChanged && (targetQuery.isPending || targetQuery.isFetching || !!targetQuery.error)) || (!!existing && !existingAction)} onClick={() => submit("preview")}>{busy ? "处理中…" : "预览修改范围"}</button>
      </section>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">{error}</p>}
      {preview && <section className="space-y-4 rounded-xl border border-blue-200 bg-white p-5">
        <h2 className="font-semibold">3. 确认修改</h2><p>{preview.sourceCode} {preview.sourceName} → <strong>{preview.targetCode} {preview.targetName}</strong></p>
        <p className="text-sm">更新 {preview.programs.length} 个培养方案，另有 {preview.unchangedPrograms} 个匹配方案保持不变。匹配依据：{preview.scope === "name" ? "原课程名" : preview.scope === "both" ? "原课号和原课程名" : "原课号"}。</p>
        <ul className="max-h-48 space-y-2 overflow-y-auto text-sm text-slate-600">{preview.programs.map(p => <li key={p.id}>{p.year} · {p.majorName}<span className="block text-xs">{[...new Set(p.matches.map(c => `${c.code} ${c.name}`))].join("；")}</span></li>)}</ul>
        <p className="text-sm">课程库信息：{preview.details.credits} 学分 · {preview.details.department || "未填写开课学院"} · {preview.details.category || "未填写分类"} · {preview.details.semester || "未填写学期"}</p>
        {preview.details.description && <p className="whitespace-pre-wrap text-sm">课程简介：{preview.details.description}</p>}
        {preview.existingTarget ? <p className="text-sm">{preview.existingAction === "merge_resources" ? `合并资源：从 ${preview.resourceCodes.join("、")} 移出资源关联，向目标课程追加 ${preview.appendResources} 项资源；重复关联自动跳过，附件和审核历史保留。` : "仅替换课程引用，所有原资源留在原课程。"}</p> : preview.codeChanged && <p className="text-sm">匹配课程的投稿资源 {preview.counts.resources} 条关联{preview.migrate ? "迁移至新课程" : "保留在原课程，不复制或迁移"}；选中课程的以下内容将{preview.migrate ? "迁移" : "复制"}至新课程：修课记录 {preview.counts.records} 条、教师 {preview.counts.teachers} 位、先修关系 {preview.counts.prerequisites} 条、期末复习内容 {preview.counts.examPrep} 份。附件、投稿及审核历史随资源保留。</p>}
        <button type="button" onClick={() => submit("apply")} className={buttonClass}>{busy ? "正在保存…" : "确认并保存修改"}</button>
      </section>}
    </fieldset>
  </main>;
}
