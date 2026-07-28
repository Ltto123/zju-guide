"use client";

// =============================================================================
// admin/review/page.tsx — 审核后台（仅管理员可访问）
// =============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Shield,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  User,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Loader2,
  SearchX,
  Filter,
  Eye,
  EyeOff,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { api, ApiError } from "@/lib/api-client";

// ─── Types ──────────────────────────────────────────────────

interface SubmissionItem {
  id: string;
  resource: {
    id: string;
    title: string;
    type: string;
    url: string | null;
    summary: string | null;
    applicableStage: string | null;
  };
  submitter: {
    id: string;
    username: string;
  };
  submittedAt: string;
  reviewedAt: string | null;
  result: "APPROVED" | "REJECTED" | "NEEDS_REVISION" | "MERGED" | null;
  reason: string | null;
  courses: { code: string; name: string }[];
}

interface SubmissionsResponse {
  pending: SubmissionItem[];
  reviewed: SubmissionItem[];
}

// ─── Constants ──────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  EBOOK: "电子书/教材",
  LECTURE_NOTE: "课堂笔记",
  EXAM_RECALL: "真题回忆",
  BLOG: "博客/经验帖",
  CC98_POST: "CC98 帖子",
  TOOL_TEMPLATE: "工具/模板",
  OTHER: "其他",
};

const STAGE_LABELS: Record<string, string> = {
  BEFORE: "课前预习",
  DURING: "课中跟课",
  FINAL: "期末复习",
  ALL: "全部阶段",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Sub-components ────────────────────────────────────────

/** Skeleton row for loading state */
function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-slate-100 px-6 py-4"
        >
          <div className="h-4 w-48 rounded bg-slate-200" />
          <div className="h-4 w-20 rounded bg-slate-200" />
          <div className="h-4 w-16 rounded bg-slate-200" />
          <div className="ml-auto h-8 w-32 rounded bg-slate-200" />
        </div>
      ))}
    </div>
  );
}

/** Empty state */
function EmptyState({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <Icon className="h-12 w-12 text-slate-300" />
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className="text-xs text-slate-400">{description}</p>
    </div>
  );
}

/** Error state */
function ErrorDisplay({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <AlertCircle className="h-12 w-12 text-red-400" />
      <div className="text-center">
        <p className="text-sm font-medium text-red-700">{message}</p>
        <p className="mt-1 text-xs text-red-500">请检查网络后重试</p>
      </div>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm text-red-700 transition hover:bg-red-100"
      >
        <RefreshCw className="h-4 w-4" />
        重新加载
      </button>
    </div>
  );
}

/** Rejection dialog (modal) */
function RejectDialog({
  open,
  onClose,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");

  if (!open) return null;

  const handleSubmit = () => {
    if (!reason.trim()) return;
    onSubmit(reason.trim());
    setReason("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 mx-4 w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-slate-900">驳回资源</h3>
        <p className="mt-1 text-sm text-slate-500">
          请输入驳回理由，投稿者将收到通知。
        </p>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          placeholder="例：内容重复、信息不完整、版权存疑..."
          className={cn(
            "mt-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm transition-colors resize-none",
            "focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400",
            "placeholder:text-slate-400",
          )}
          autoFocus
        />

        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={() => {
              setReason("");
              onClose();
            }}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!reason.trim() || isPending}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium text-white transition",
              "bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                处理中...
              </span>
            ) : (
              "确认驳回"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Single submission row (pending) */
function PendingRow({
  item,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: {
  item: SubmissionItem;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isApproving: boolean;
  isRejecting: boolean;
}) {
  const busy = isApproving || isRejecting;

  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 last:border-b-0 sm:flex-row sm:items-center">
      {/* Left: info */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start gap-2">
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
            {TYPE_LABELS[item.resource.type] ?? item.resource.type}
          </span>
          <p className="text-sm font-medium text-slate-800 truncate">
            {item.resource.title}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {item.submitter.username}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTime(item.submittedAt)}
          </span>
          {item.resource.applicableStage && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-600">
              {STAGE_LABELS[item.resource.applicableStage] ?? item.resource.applicableStage}
            </span>
          )}
        </div>

        {/* Courses */}
        {item.courses.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.courses.map((c) => (
              <span
                key={c.code}
                className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600"
              >
                <span className="course-code">{c.code}</span> {c.name}
              </span>
            ))}
          </div>
        )}

        {/* Summary */}
        {item.resource.summary && (
          <p className="text-xs text-slate-500 line-clamp-2">
            {item.resource.summary}
          </p>
        )}

        {/* URL link */}
        {item.resource.url && (
          <a
            href={item.resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            查看链接
          </a>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onApprove(item.id)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 transition hover:bg-green-100 disabled:opacity-50"
        >
          {isApproving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          通过
        </button>
        <button
          onClick={() => onReject(item.id)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
        >
          {isRejecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          驳回
        </button>
      </div>
    </div>
  );
}

/** Reviewed row (collapsed by default) */
function ReviewedGroup({
  items,
}: {
  items: SubmissionItem[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      {/* Header — click to expand/collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-6 py-3 text-left transition hover:bg-slate-50"
      >
        <span className="text-sm font-medium text-slate-600">
          已审核
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
          {items.length} 项
        </span>
        {expanded ? (
          <ChevronUp className="ml-auto h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDown className="ml-auto h-4 w-4 text-slate-400" />
        )}
      </button>

      {/* Expandable list */}
      {expanded && (
        <div className="divide-y divide-slate-50 border-t border-slate-100 bg-slate-50/50">
          {items.map((item) => (
            <div key={item.id} className="px-6 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium",
                        item.result === "APPROVED"
                          ? "bg-green-100 text-green-700"
                          : item.result === "REJECTED"
                            ? "bg-red-100 text-red-700"
                            : "bg-yellow-100 text-yellow-700",
                      )}
                    >
                      {item.result === "APPROVED"
                        ? "已通过"
                        : item.result === "REJECTED"
                          ? "已驳回"
                          : item.result ?? "已处理"}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                      {TYPE_LABELS[item.resource.type] ?? item.resource.type}
                    </span>
                    <span className="text-sm font-medium text-slate-700 truncate">
                      {item.resource.title}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                    <span>{item.submitter.username}</span>
                    <span>
                      提交: {formatTime(item.submittedAt)}
                    </span>
                    {item.reviewedAt && (
                      <span>审核: {formatTime(item.reviewedAt)}</span>
                    )}
                  </div>

                  {/* Reason */}
                  {item.reason && (
                    <p className="mt-1 text-xs text-slate-500">
                      理由: {item.reason}
                    </p>
                  )}

                  {/* Courses */}
                  {item.courses.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {item.courses.map((c) => (
                        <span
                          key={c.code}
                          className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-500"
                        >
                          <span className="course-code">{c.code}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {item.resource.url && (
                  <a
                    href={item.resource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs text-blue-500 hover:underline inline-flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    链接
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export default function AdminReviewPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  // ---- Reject dialog state ----
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);

  // ---- Tab filter: "pending" or "reviewed" ----
  const [tab, setTab] = useState<"pending" | "reviewed">("pending");

  // ---- Fetch submissions ----
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<SubmissionsResponse>({
    queryKey: ["admin", "submissions"],
    queryFn: () =>
      api.get<SubmissionsResponse>("/api/admin/submissions"),
    enabled: !isAuthLoading,
  });

  // ---- Mutations ----
  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/api/admin/submissions/${id}`, { result: "APPROVED" }),
    onSuccess: () => {
      toast.success("资源已通过审核");
      queryClient.invalidateQueries({ queryKey: ["admin", "submissions"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : "操作失败，请重试",
      );
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`/api/admin/submissions/${id}`, {
        result: "REJECTED",
        reason,
      }),
    onSuccess: () => {
      toast.success("资源已驳回");
      setRejectTargetId(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "submissions"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : "操作失败，请重试",
      );
    },
  });

  // ---- Derived ----
  const pending = data?.pending ?? [];
  const reviewed = data?.reviewed ?? [];
  const activeItems = tab === "pending" ? pending : reviewed;
  const hasData = pending.length > 0 || reviewed.length > 0;

  // ---- Auth loading ----
  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Shield className="h-10 w-10 animate-pulse text-slate-300" />
          <p className="text-sm text-slate-400">验证权限中...</p>
        </div>
      </div>
    );
  }

  // ---- Not admin ----
  if (user?.role !== "ADMIN") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="max-w-sm rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <Shield className="mx-auto mb-4 h-12 w-12 text-red-400" />
          <h1 className="text-lg font-semibold text-red-800">无权访问</h1>
          <p className="mt-2 text-sm text-red-600">
            此页面仅限管理员访问。如需升级权限，请联系系统管理员。
          </p>
          <button
            onClick={() => router.push("/")}
            className="mt-6 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm text-red-700 transition hover:bg-red-100"
          >
            <ChevronLeft className="h-4 w-4" />
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Header ──────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/")}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 transition"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h1 className="text-lg font-semibold text-slate-900">审核后台</h1>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Shield className="h-4 w-4 text-blue-500" />
            <span className="text-slate-600">{user.username}</span>
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
              管理员
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
        {/* ── Tab bar ────────────────────────────────── */}
        <div className="mb-6 flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          <button
            onClick={() => setTab("pending")}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition",
              tab === "pending"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            待审核
            {pending.length > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                {pending.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("reviewed")}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition",
              tab === "reviewed"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            已审核
            {reviewed.length > 0 && (
              <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">
                {reviewed.length}
              </span>
            )}
          </button>
        </div>

        {/* ── Content area ───────────────────────────── */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* Loading */}
          {isLoading && <TableSkeleton rows={6} />}

          {/* Error */}
          {isError && (
            <ErrorDisplay
              message={
                error instanceof Error ? error.message : "加载审核列表失败"
              }
              onRetry={() => refetch()}
            />
          )}

          {/* Empty */}
          {!isLoading && !isError && !hasData && (
            <EmptyState
              title="暂无审核项"
              description="当有新资源投稿时，它们将出现在这里"
              icon={SearchX}
            />
          )}

          {/* Tab-specific empty */}
          {!isLoading &&
            !isError &&
            hasData &&
            tab === "pending" &&
            pending.length === 0 && (
              <EmptyState
                title="所有投稿已处理完毕"
                description="切换到「已审核」标签查看历史记录"
                icon={CheckCircle2}
              />
            )}

          {/* Pending list */}
          {!isLoading && !isError && tab === "pending" && pending.length > 0 && (
            <div>
              {pending.map((item) => (
                <PendingRow
                  key={item.id}
                  item={item}
                  onApprove={(id) => approveMutation.mutate(id)}
                  onReject={(id) => setRejectTargetId(id)}
                  isApproving={
                    approveMutation.isPending &&
                    approveMutation.variables === item.id
                  }
                  isRejecting={
                    rejectMutation.isPending &&
                    rejectMutation.variables?.id === item.id
                  }
                />
              ))}
            </div>
          )}

          {/* Reviewed list (collapsed groups) */}
          {!isLoading && !isError && tab === "reviewed" && reviewed.length > 0 && (
            <ReviewedGroup items={reviewed} />
          )}
        </div>
      </div>

      {/* ── Reject dialog ───────────────────────────── */}
      <RejectDialog
        open={rejectTargetId !== null}
        onClose={() => setRejectTargetId(null)}
        onSubmit={(reason) => {
          if (rejectTargetId) {
            rejectMutation.mutate({ id: rejectTargetId, reason });
          }
        }}
        isPending={rejectMutation.isPending}
      />
    </div>
  );
}
