"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { RESOURCE_TYPE_LABELS, APPLICABLE_STAGE_LABELS } from "@/lib/constants";

type Candidate = {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  type: string;
  applicableStage: string;
  courseCodes: string[];
  resourceScope?: "COURSE" | "GENERAL";
  courseLabels?: Record<string, string>;
  matchReason: string | null;
  confirmed: boolean;
  status: "READY" | "SUBMITTED" | "DUPLICATE" | "FAILED";
  duplicateResourceId?: string | null;
  resourceId?: string | null;
  error?: string | null;
};
type Job = {
  id: string;
  sourceId: string;
  status: string;
  scanned: number;
  error?: string | null;
  createdAt: string;
  candidates?: Candidate[];
};
type Source = { id: string; name: string; baseUrl: string };
const endpoint = "/api/admin/website-imports";
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30";
const buttonClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const statusLabels: Record<string, string> = {
  QUEUED: "排队中",
  RUNNING: "扫描中",
  COMPLETED: "扫描完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  WITHDRAWN: "已撤回",
  READY: "待确认",
  SUBMITTED: "已送审",
  DUPLICATE: "重复，已跳过",
};
const active = (job?: Job) => job?.status === "QUEUED" || job?.status === "RUNNING";
const message = (error: unknown) => (error instanceof Error ? error.message : "操作失败，请重试");

function CandidateEditor({
  candidate,
  jobId,
  locked,
  selected,
  onSelect,
  onSaved,
  onDirty,
}: {
  candidate: Candidate;
  jobId: string;
  locked: boolean;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onSaved: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(candidate);
  const [dirty, setDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(candidate.confirmed);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const courses = useQuery({
    queryKey: ["website-import-course-search", debouncedSearch],
    queryFn: () =>
      api.get<{ code: string; name: string }[]>(
        `/api/courses?search=${encodeURIComponent(debouncedSearch)}&pageSize=15`,
      ),
    enabled: !!debouncedSearch && !locked,
    staleTime: 30_000,
  });
  const editable = !locked && (candidate.status === "READY" || candidate.status === "FAILED");
  function change(patch: Partial<Candidate>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setDirty(true);
    onDirty(true);
    setConfirmed(false);
    onSelect(false);
  }
  async function save() {
    setSaving(true);
    try {
      await api.patch(`${endpoint}/${jobId}`, {
        action: "update",
        candidateId: candidate.id,
        title: draft.title.trim(),
        summary: draft.summary ?? "",
        type: draft.type,
        applicableStage: draft.applicableStage,
        courseCodes: draft.courseCodes,
        resourceScope: draft.resourceScope ?? "COURSE",
      });
      await onSaved();
      setDirty(false);
      onDirty(false);
      toast.success("已保存并确认资源");
    } catch (error) {
      toast.error(message(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`选择 ${candidate.title}`}
          checked={selected}
          disabled={!editable || !candidate.confirmed || dirty || saving}
          onChange={(event) => onSelect(event.target.checked)}
          className="mt-1 h-4 w-4"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{candidate.title}</p>
          {candidate.resourceScope === "GENERAL" && (
            <p className="mt-1 text-xs text-slate-500">通用资源入口（无需关联课程）</p>
          )}
          <a
            href={candidate.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block break-all text-xs text-blue-600 hover:underline"
          >
            {candidate.url}
          </a>
        </div>
        <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {candidate.status === "READY" && candidate.confirmed
            ? "已确认"
            : statusLabels[candidate.status]}
        </span>
      </div>
      {candidate.error && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {candidate.error}
        </p>
      )}
      {candidate.duplicateResourceId && (
        <Link
          href={`/resource/${candidate.duplicateResourceId}`}
          className="text-sm text-blue-600 hover:underline"
        >
          查看已有资源
        </Link>
      )}
      {candidate.resourceId && (
        <Link
          href={`/resource/${candidate.resourceId}`}
          className="text-sm text-blue-600 hover:underline"
        >
          查看已投稿资源
        </Link>
      )}
      {editable && (
        <fieldset disabled={saving} className="space-y-3">
          <label className="block text-sm text-slate-700">
            标题
            <input
              className={`${inputClass} mt-1`}
              value={draft.title}
              maxLength={120}
              onChange={(e) => change({ title: e.target.value })}
            />
          </label>
          <label className="block text-sm text-slate-700">
            摘要
            <textarea
              className={`${inputClass} mt-1`}
              rows={3}
              maxLength={500}
              value={draft.summary ?? ""}
              onChange={(e) => change({ summary: e.target.value })}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-700">
              资源类型
              <select
                className={`${inputClass} mt-1`}
                value={draft.type}
                onChange={(e) => change({ type: e.target.value })}
              >
                {Object.entries(RESOURCE_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-700">
              适用阶段
              <select
                className={`${inputClass} mt-1`}
                value={draft.applicableStage}
                onChange={(e) => change({ applicableStage: e.target.value })}
              >
                {Object.entries(APPLICABLE_STAGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm text-slate-700">
            资源范围
            <select
              className={`${inputClass} mt-1`}
              value={draft.resourceScope ?? "COURSE"}
              onChange={(event) =>
                change({ resourceScope: event.target.value as "COURSE" | "GENERAL" })
              }
            >
              <option value="COURSE">课程资源</option>
              <option value="GENERAL">通用资源入口（无需关联课程）</option>
            </select>
          </label>
          <div className="rounded-lg bg-blue-50 p-3 text-sm">
            {draft.resourceScope === "GENERAL" ? (
              <p className="text-slate-700">作为通用资源入口投稿，无需关联具体课程。</p>
            ) : (
              <>
                <p className="text-slate-700">
                  课程建议：{candidate.matchReason || "暂无可靠匹配，请手动搜索课程"}
                </p>
                <div className="my-2 flex flex-wrap gap-2">
                  {draft.courseCodes.map((code) => (
                    <button
                      key={code}
                      type="button"
                      className="rounded-full border border-blue-200 bg-white px-2 py-1 text-xs text-blue-700"
                      aria-label={`移除课程 ${code}`}
                      onClick={() =>
                        change({ courseCodes: draft.courseCodes.filter((item) => item !== code) })
                      }
                    >
                      {draft.courseLabels?.[code] ?? candidate.courseLabels?.[code] ?? "课程"} ·{" "}
                      {code} ×
                    </button>
                  ))}
                </div>
                <label className="block">
                  关联课程
                  <input
                    className={`${inputClass} mt-1`}
                    placeholder="搜索课程名称或课号"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {debouncedSearch && (
                  <div className="mt-2 max-h-40 overflow-auto rounded border border-blue-100 bg-white">
                    {courses.isFetching ? (
                      <p className="p-2 text-slate-500">搜索中…</p>
                    ) : courses.isError ? (
                      <button
                        type="button"
                        onClick={() => void courses.refetch()}
                        className="p-2 text-red-600"
                      >
                        搜索失败，点击重试
                      </button>
                    ) : !courses.data?.length ? (
                      <p className="p-2 text-slate-500">未找到课程</p>
                    ) : (
                      courses.data.map((course) => (
                        <button
                          type="button"
                          key={course.code}
                          disabled={draft.courseCodes.includes(course.code)}
                          className="block w-full px-3 py-2 text-left hover:bg-blue-50 disabled:opacity-40"
                          onClick={() => {
                            change({
                              courseCodes: [...draft.courseCodes, course.code],
                              courseLabels: { ...draft.courseLabels, [course.code]: course.name },
                            });
                            setSearch("");
                          }}
                        >
                          {course.code} · {course.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
            <label className="mt-3 flex items-start gap-2 text-slate-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                onChange={(e) => {
                  setConfirmed(e.target.checked);
                  setDirty(true);
                  onDirty(true);
                  onSelect(false);
                }}
              />
              {draft.resourceScope === "GENERAL" ? "我已核对通用资源入口" : "我已核对以上课程关联"}
            </label>
          </div>
          <button
            type="button"
            className={buttonClass}
            disabled={
              !confirmed ||
              (draft.resourceScope !== "GENERAL" && !draft.courseCodes.length) ||
              draft.title.trim().length < 2 ||
              saving ||
              (!dirty && candidate.confirmed)
            }
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存并确认"}
          </button>
        </fieldset>
      )}
    </article>
  );
}

export function WebsiteImportPanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [source, setSource] = useState("");
  const [includeUnmatchedAsGeneral, setIncludeUnmatchedAsGeneral] = useState(false);
  const [chosenJob, setChosenJob] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);
  const [submissionFeedback, setSubmissionFeedback] = useState("");
  const list = useQuery({
    queryKey: ["website-imports", user?.id],
    queryFn: () => api.get<{ sources: Source[]; jobs: Job[]; enabled: boolean }>(endpoint),
    enabled: user?.role === "ADMIN",
    retry: false,
    refetchInterval: (query) => (query.state.data?.jobs.some(active) ? 3000 : false),
  });
  const jobId = chosenJob || list.data?.jobs[0]?.id || "";
  const detail = useQuery({
    queryKey: ["website-import", user?.id, jobId],
    queryFn: () => api.get<Job>(`${endpoint}/${jobId}`),
    enabled: user?.role === "ADMIN" && !!jobId && !list.isError,
    retry: false,
    refetchInterval: (query) => (active(query.state.data) ? 2000 : false),
  });
  const job = detail.data;
  const closed = job?.status === "WITHDRAWN" || job?.status === "CANCELLED";
  const candidates = job?.candidates ?? [];
  const eligible = candidates.filter(
    (candidate) => candidate.confirmed && ["READY", "FAILED"].includes(candidate.status),
  );
  const ready = candidates.filter(
    (candidate) =>
      ["READY", "FAILED"].includes(candidate.status) &&
      (includeUnmatchedAsGeneral || candidate.confirmed ||
        candidate.resourceScope === "GENERAL" ||
        candidate.courseCodes.length === 1),
  );
  const hasUnsavedChanges = candidates.some((candidate) => dirtyIds.includes(candidate.id));
  const selectedIds = selected.filter((id) => eligible.some((candidate) => candidate.id === id));
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["website-imports"] }),
      queryClient.invalidateQueries({ queryKey: ["website-import"] }),
    ]);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (user?.role !== "ADMIN") return null;
  if (list.isPending)
    return (
      <p role="status" className="p-6 text-sm text-slate-500">
        正在读取网站导入任务…
      </p>
    );
  if (list.isError || list.data?.enabled === false)
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"
      >
        {list.data?.enabled === false
          ? "网站导入功能尚未启用，请联系部署管理员。"
          : message(list.error)}
        <button type="button" onClick={() => void list.refetch()} className="ml-3 underline">
          重新检查
        </button>
      </div>
    );
  return (
    <div className="space-y-5">
      <form
        className="rounded-xl border border-blue-200 bg-blue-50/40 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const sourceId =
              list.data?.sources.find((item) => item.name === source.trim())?.id ?? source.trim();
            const created = await api.post<Job>(endpoint, { sourceId });
            setChosenJob(created.id);
            setSelected([]);
            setDirtyIds([]);
            setSubmissionFeedback("");
            toast.success("扫描任务已创建");
          });
        }}
      >
        <h2 className="font-semibold text-slate-900">从公开网站发现资源</h2>
        <p className="mt-1 text-sm text-slate-500">
          支持粘贴自定义公开 HTTP/HTTPS
          网址；网站名称仅支持下方推荐来源。扫描后可一键投稿明确匹配的课程资源与通用入口，仅保存链接。每次最多
          30 条，每日最多 100 条。
        </p>
        <label className="mt-4 block text-sm text-slate-700">
          推荐网站名称或公开网址
          <input
            list="website-import-sources"
            className={`${inputClass} mt-2`}
            placeholder="选择推荐网站，或粘贴公开网址 https://…"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            required
            disabled={busy}
          />
        </label>
        <datalist id="website-import-sources">
          {list.data?.sources.map((item) => (
            <option key={item.id} value={item.name}>
              {item.baseUrl}
            </option>
          ))}
        </datalist>
        <button
          type="submit"
          disabled={busy || !source.trim()}
          className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "处理中…" : "开始扫描"}
        </button>
      </form>
      <label className="block text-sm font-medium text-slate-700">
        历史任务
        <select
          className={`${inputClass} mt-2`}
          disabled={busy}
          value={jobId}
          onChange={(e) => {
            setChosenJob(e.target.value);
            setSelected([]);
            setDirtyIds([]);
            setSubmissionFeedback("");
          }}
        >
          {!list.data?.jobs.length && <option value="">暂无导入任务</option>}
          {list.data?.jobs.map((item) => (
            <option key={item.id} value={item.id}>
              {new Date(item.createdAt).toLocaleString("zh-CN")} ·{" "}
              {list.data.sources.find((s) => s.id === item.sourceId)?.name ?? item.sourceId} ·{" "}
              {statusLabels[item.status] ?? item.status}
            </option>
          ))}
        </select>
      </label>
      {jobId && detail.isPending && (
        <p role="status" className="text-sm text-slate-500">
          正在读取候选资源…
        </p>
      )}
      {detail.isError && (
        <p role="alert" className="text-sm text-red-600">
          {message(detail.error)}{" "}
          <button type="button" className="underline" onClick={() => void detail.refetch()}>
            重试
          </button>
        </p>
      )}
      {job && (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p role="status" className="text-sm font-medium text-slate-700">
              {statusLabels[job.status] ?? job.status} · 已扫描 {job.scanned} 项 ·{" "}
              {candidates.length} 条候选
            </p>
            {job.error && (
              <p role="alert" className="mt-2 text-sm text-red-600">
                {job.error}
              </p>
            )}
            {submissionFeedback && (
              <p role="status" className="mt-2 text-sm text-slate-700">
                {submissionFeedback}
              </p>
            )}
            {job.status === "COMPLETED" && <label className="mt-3 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={includeUnmatchedAsGeneral} disabled={busy} onChange={e => setIncludeUnmatchedAsGeneral(e.target.checked)} />未匹配或匹配不唯一的条目作为通用资源投稿（不关联课程）</label>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {job.status === "COMPLETED" && (
                <button
                  type="button"
                  disabled={busy || !ready.length || hasUnsavedChanges}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  onClick={() =>
                    void run(async () => {
                      const result = await api.post<{
                        results: { candidateId: string; status: string; error?: string }[];
                        skipped: number;
                      }>(`${endpoint}/${job.id}`, { action: "submit-ready", includeUnmatchedAsGeneral });
                      const failures = result.results.filter((item) => item.status === "FAILED");
                      const submitted = result.results.filter(
                        (item) => item.status === "SUBMITTED",
                      ).length;
                      const duplicates = result.results.filter(
                        (item) => item.status === "DUPLICATE",
                      ).length;
                      const feedback = `已送审 ${submitted} 条，重复 ${duplicates} 条，失败 ${failures.length} 条，跳过 ${result.skipped} 条。`;
                      setSubmissionFeedback(feedback);
                      setSelected(failures.map((item) => item.candidateId));
                      if (failures.length) toast.error(feedback);
                      else toast.success(feedback);
                    })
                  }
                >
                  {busy ? "投稿处理中…" : `一键投稿可用资源（${ready.length}条）`}
                </button>
              )}
              {active(job) && (
                <button
                  type="button"
                  disabled={busy}
                  className={buttonClass}
                  onClick={() =>
                    void run(async () => {
                      await api.patch(`${endpoint}/${job.id}`, { action: "cancel" });
                      setSelected([]);
                    })
                  }
                >
                  取消扫描
                </button>
              )}
              {!closed && !active(job) && (
                <button
                  type="button"
                  disabled={busy}
                  className={buttonClass}
                  onClick={() => {
                    if (
                      window.confirm(
                        "确定撤回这一批次？这会撤回本批次新建的资源，包括已审核通过的资源；已有重复资源不受影响。",
                      )
                    )
                      void run(async () => {
                        await api.patch(`${endpoint}/${job.id}`, { action: "withdraw" });
                        setSelected([]);
                        toast.success("批次已撤回");
                      });
                  }}
                >
                  撤回批次
                </button>
              )}
              <Link
                href={`/admin/review?batch=${job.id}`}
                className="text-sm text-blue-600 hover:underline"
              >
                前往审核此批次 →
              </Link>
            </div>
            {job.status === "COMPLETED" && (
              <p className="mt-3 text-xs text-slate-500">
                一键投稿将确认并提交单一课程建议、已人工确认项及通用入口；未匹配或匹配不唯一的条目默认跳过，勾选上方选项后将作为不关联课程的通用资源投稿。
                {hasUnsavedChanges && " 请先保存候选资源的修改，再一键投稿。"}
              </p>
            )}
          </div>
          {!candidates.length && !active(job) && (
            <p className="py-4 text-center text-sm text-slate-500">此任务没有可导入的候选资源。</p>
          )}
          {candidates.map((candidate) => (
            <CandidateEditor
              key={`${job.id}:${candidate.id}`}
              candidate={candidate}
              jobId={job.id}
              locked={busy || closed || active(job)}
              selected={selectedIds.includes(candidate.id)}
              onSelect={(checked) =>
                setSelected((previous) =>
                  checked
                    ? [...new Set([...previous, candidate.id])]
                    : previous.filter((id) => id !== candidate.id),
                )
              }
              onSaved={refresh}
              onDirty={(dirty) =>
                setDirtyIds((previous) =>
                  dirty
                    ? [...new Set([...previous, candidate.id])]
                    : previous.filter((id) => id !== candidate.id),
                )
              }
            />
          ))}
          {!!candidates.length && !closed && !active(job) && (
            <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-600">
                已选 {selectedIds.length} / 30 条 · 仅可选择已保存确认的资源
              </p>
              <button
                type="button"
                disabled={busy || !selectedIds.length || selectedIds.length > 30}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={() =>
                  void run(async () => {
                    const result = await api.post<{
                      results: { candidateId: string; status: string; error?: string }[];
                    }>(`${endpoint}/${job.id}`, { candidateIds: selectedIds });
                    const failures = result.results.filter((item) => item.status === "FAILED");
                    setSelected(failures.map((item) => item.candidateId));
                    if (failures.length)
                      toast.error(`${failures.length} 条提交失败，可检查错误后重试`);
                    else toast.success("所选资源已处理，请前往批次审核");
                  })
                }
              >
                {busy ? "提交中…" : "提交所选 / 重试失败项"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
