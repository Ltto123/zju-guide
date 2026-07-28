"use client";

// =============================================================================
// (dashboard)/contribute/page.tsx — 资源投稿页
// =============================================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileText,
  Send,
  BookOpen,
  LinkIcon,
  AlertCircle,
  RefreshCw,
  X,
  Search,
  ChevronDown,
  Check,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api-client";

// ─── Types ──────────────────────────────────────────────────

type ResourceTypeEnum =
  | "EBOOK"
  | "LECTURE_NOTE"
  | "EXAM_RECALL"
  | "BLOG"
  | "CC98_POST"
  | "TOOL_TEMPLATE"
  | "OTHER";

type ApplicableStageEnum = "BEFORE" | "DURING" | "FINAL" | "ALL";

type CopyrightStatusEnum =
  | "PUBLIC_DOMAIN"
  | "AUTHORIZED"
  | "EXTERNAL_LINK"
  | "UNKNOWN";

interface CourseOption {
  code: string;
  name: string;
  credits: number;
  department: string | null;
}

// ─── Constants ──────────────────────────────────────────────

const RESOURCE_TYPE_LABELS: Record<ResourceTypeEnum, string> = {
  EBOOK: "电子书/教材",
  LECTURE_NOTE: "课堂笔记",
  EXAM_RECALL: "真题回忆",
  BLOG: "博客/经验帖",
  CC98_POST: "CC98 帖子",
  TOOL_TEMPLATE: "工具/模板",
  OTHER: "其他",
};

const STAGE_LABELS: Record<ApplicableStageEnum, string> = {
  BEFORE: "课前预习",
  DURING: "课中跟课",
  FINAL: "期末复习",
  ALL: "全部阶段",
};

const COPYRIGHT_LABELS: Record<CopyrightStatusEnum, string> = {
  PUBLIC_DOMAIN: "公共领域 / 原创内容",
  AUTHORIZED: "已获授权转载",
  EXTERNAL_LINK: "仅提供外部链接",
  UNKNOWN: "不确定版权状态",
};

// ─── Form Schema ────────────────────────────────────────────

const contributeSchema = z.object({
  type: z.enum([
    "EBOOK",
    "LECTURE_NOTE",
    "EXAM_RECALL",
    "BLOG",
    "CC98_POST",
    "TOOL_TEMPLATE",
    "OTHER",
  ] as const, {
    required_error: "请选择资源类型",
  }),
  title: z
    .string()
    .min(2, "标题至少 2 个字符")
    .max(120, "标题最多 120 个字符"),
  url: z
    .string()
    .url("请输入有效的链接")
    .optional()
    .or(z.literal("")),
  summary: z
    .string()
    .max(500, "摘要最多 500 个字符")
    .optional()
    .or(z.literal("")),
  applicableStage: z.enum(["BEFORE", "DURING", "FINAL", "ALL"] as const, {
    required_error: "请选择适用阶段",
  }),
  courseCodes: z
    .array(z.string())
    .min(1, "请至少关联一门课程"),
  copyrightStatus: z.enum([
    "PUBLIC_DOMAIN",
    "AUTHORIZED",
    "EXTERNAL_LINK",
    "UNKNOWN",
  ] as const, {
    required_error: "请选择版权状态",
  }),
  copyrightAgreed: z.literal(true, {
    errorMap: () => ({ message: "请确认版权声明" }),
  }),
});

type ContributeFormValues = z.infer<typeof contributeSchema>;

// ─── API helpers ────────────────────────────────────────────

async function searchCourses(query: string): Promise<CourseOption[]> {
  if (!query.trim()) return [];
  const res = await fetch(
    `/api/courses?search=${encodeURIComponent(query)}&pageSize=15`,
  );
  if (!res.ok) throw new Error("搜索课程失败");
  const json = await res.json();
  return json.data ?? [];
}

async function submitResource(data: ContributeFormValues): Promise<{ id: string }> {
  return api.post<{ id: string }>("/api/resources", {
    type: data.type,
    title: data.title,
    url: data.url || null,
    summary: data.summary || null,
    applicableStage: data.applicableStage,
    copyrightStatus: data.copyrightStatus,
    courseCodes: data.courseCodes,
  });
}

// ─── Sub-components ────────────────────────────────────────

/** Loading skeleton for the form area */
function FormSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i}>
          <div className="mb-2 h-5 w-20 rounded bg-slate-200" />
          <div className="h-10 w-full rounded-lg bg-slate-200" />
        </div>
      ))}
      <div className="h-10 w-full rounded-lg bg-slate-200" />
    </div>
  );
}

/** Error display for the page-level errors */
function ErrorDisplay({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
      <AlertCircle className="mx-auto mb-3 h-12 w-12 text-red-400" />
      <p className="mb-2 text-sm font-medium text-red-800">{message}</p>
      <button
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm text-red-700 transition hover:bg-red-100"
      >
        <RefreshCw className="h-4 w-4" />
        重试
      </button>
    </div>
  );
}

/** Field error message */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500">
      <AlertCircle className="h-3 w-3" />
      {message}
    </p>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export default function ContributePage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // ---- Search state ----
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);

  // Debounce the search query (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ---- Form ----
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContributeFormValues>({
    resolver: zodResolver(contributeSchema),
    defaultValues: {
      type: undefined,
      title: "",
      url: "",
      summary: "",
      applicableStage: "ALL",
      courseCodes: [],
      copyrightStatus: undefined,
      copyrightAgreed: false as unknown as true,
    },
  });

  const selectedCourseCodes = watch("courseCodes");

  // ---- Course search query ----
  const {
    data: searchResults = [],
    isLoading: isSearching,
    isError: isSearchError,
    refetch: refetchSearch,
  } = useQuery({
    queryKey: ["course-search", debouncedQuery],
    queryFn: () => searchCourses(debouncedQuery),
    enabled: debouncedQuery.trim().length > 0,
    staleTime: 30_000,
  });

  // ---- Submit mutation ----
  const submitMutation = useMutation({
    mutationFn: submitResource,
    onSuccess: (result) => {
      toast.success("投稿已提交，等待审核");
      queryClient.invalidateQueries({ queryKey: ["resources"] });
      // Navigate to the first associated course page
      const firstCode = selectedCourseCodes[0];
      if (firstCode) {
        router.push(`/course/${firstCode}`);
      } else {
        router.push("/");
      }
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "提交失败，请稍后重试";
      toast.error(message);
    },
  });

  // ---- Handlers ----

  const onSubmit = handleSubmit((data) => {
    submitMutation.mutate(data);
  });

  const addCourse = useCallback(
    (course: CourseOption) => {
      const current = watch("courseCodes");
      if (!current.includes(course.code)) {
        setValue("courseCodes", [...current, course.code], {
          shouldValidate: true,
        });
      }
      setSearchQuery("");
      setSearchDropdownOpen(false);
    },
    [watch, setValue],
  );

  const removeCourse = useCallback(
    (code: string) => {
      const current = watch("courseCodes");
      setValue(
        "courseCodes",
        current.filter((c) => c !== code),
        { shouldValidate: true },
      );
    },
    [watch, setValue],
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        searchInputRef.current &&
        !searchInputRef.current.parentElement?.contains(e.target as Node)
      ) {
        setSearchDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      {/* ── Header ──────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          投稿资源
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          分享学习资料，帮助更多同学。提交后将由管理员审核。
        </p>
      </div>

      {/* ── Form ────────────────────────────────────── */}
      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="space-y-6">
          {/* Resource Type */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              资源类型 <span className="text-red-400">*</span>
            </label>
            <select
              {...register("type")}
              className={cn(
                "w-full rounded-lg border bg-white px-3 py-2.5 text-sm transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400",
                errors.type
                  ? "border-red-300 focus:ring-red-500/30"
                  : "border-slate-300",
              )}
            >
              <option value="">-- 请选择资源类型 --</option>
              {(
                Object.entries(RESOURCE_TYPE_LABELS) as [
                  ResourceTypeEnum,
                  string,
                ][]
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <FieldError message={errors.type?.message} />
          </div>

          {/* Title */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              标题 <span className="text-red-400">*</span>
            </label>
            <input
              {...register("title")}
              type="text"
              placeholder="例：数据结构期末复习笔记"
              className={cn(
                "w-full rounded-lg border bg-white px-3 py-2.5 text-sm transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400",
                "placeholder:text-slate-400",
                errors.title
                  ? "border-red-300 focus:ring-red-500/30"
                  : "border-slate-300",
              )}
            />
            <FieldError message={errors.title?.message} />
          </div>

          {/* URL (optional) */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              <LinkIcon className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
              链接 <span className="text-slate-400">（可选）</span>
            </label>
            <input
              {...register("url")}
              type="url"
              placeholder="https://..."
              className={cn(
                "w-full rounded-lg border bg-white px-3 py-2.5 text-sm transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400",
                "placeholder:text-slate-400",
                errors.url
                  ? "border-red-300 focus:ring-red-500/30"
                  : "border-slate-300",
              )}
            />
            <FieldError message={errors.url?.message} />
          </div>

          {/* Summary (optional) */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              摘要 <span className="text-slate-400">（可选）</span>
            </label>
            <textarea
              {...register("summary")}
              rows={3}
              placeholder="简单描述这个资源的内容和用途..."
              className={cn(
                "w-full rounded-lg border bg-white px-3 py-2.5 text-sm transition-colors resize-none",
                "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400",
                "placeholder:text-slate-400",
                errors.summary
                  ? "border-red-300 focus:ring-red-500/30"
                  : "border-slate-300",
              )}
            />
            <FieldError message={errors.summary?.message} />
          </div>

          {/* Applicable Stage */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              适用阶段 <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                Object.entries(STAGE_LABELS) as [
                  ApplicableStageEnum,
                  string,
                ][]
              ).map(([value, label]) => {
                const isSelected = watch("applicableStage") === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      setValue("applicableStage", value, {
                        shouldValidate: true,
                      })
                    }
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                      isSelected
                        ? "border-blue-300 bg-blue-50 text-blue-700 shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <FieldError message={errors.applicableStage?.message} />
          </div>

          {/* Course Selection */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              关联课程 <span className="text-red-400">*</span>
            </label>

            {/* Search input */}
            <div className="relative" ref={searchInputRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (e.target.value.trim()) setSearchDropdownOpen(true);
                  }}
                  onFocus={() => {
                    if (searchQuery.trim()) setSearchDropdownOpen(true);
                  }}
                  placeholder="搜索课程名称或课号..."
                  className={cn(
                    "w-full rounded-lg border bg-white py-2.5 pl-10 pr-4 text-sm transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400",
                    "placeholder:text-slate-400",
                    errors.courseCodes
                      ? "border-red-300 focus:ring-red-500/30"
                      : "border-slate-300",
                  )}
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
                )}
              </div>

              {/* Dropdown */}
              {searchDropdownOpen && (
                <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-60 overflow-y-auto">
                  {isSearching ? (
                    <div className="px-4 py-3 text-sm text-slate-400">
                      搜索中...
                    </div>
                  ) : isSearchError ? (
                    <div className="px-4 py-3">
                      <p className="mb-2 text-sm text-red-500">搜索失败</p>
                      <button
                        type="button"
                        onClick={() => refetchSearch()}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        点击重试
                      </button>
                    </div>
                  ) : searchResults.length === 0 && debouncedQuery ? (
                    <div className="flex flex-col items-center gap-2 px-4 py-6">
                      <BookOpen className="h-8 w-8 text-slate-300" />
                      <p className="text-sm text-slate-400">未找到匹配课程</p>
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-slate-400">
                      输入课号或关键词搜索
                    </div>
                  ) : (
                    <div className="py-1">
                      {searchResults.map((course) => {
                        const alreadySelected = selectedCourseCodes.includes(
                          course.code,
                        );
                        return (
                          <button
                            key={course.code}
                            type="button"
                            disabled={alreadySelected}
                            onClick={() => addCourse(course)}
                            className={cn(
                              "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
                              alreadySelected
                                ? "bg-slate-50 text-slate-400 cursor-not-allowed"
                                : "hover:bg-blue-50 text-slate-700",
                            )}
                          >
                            <span className="course-code rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500">
                              {course.code}
                            </span>
                            <span className="flex-1 truncate">{course.name}</span>
                            {alreadySelected && (
                              <Check className="h-4 w-4 flex-shrink-0 text-green-500" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Selected courses */}
            {selectedCourseCodes.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {selectedCourseCodes.map((code) => (
                  <span
                    key={code}
                    className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                  >
                    <span className="course-code">{code}</span>
                    <button
                      type="button"
                      onClick={() => removeCourse(code)}
                      className="ml-0.5 rounded-full p-0.5 transition hover:bg-blue-200"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <FieldError message={errors.courseCodes?.message} />
          </div>

          {/* Copyright Status */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              版权状态 <span className="text-red-400">*</span>
            </label>
            <select
              {...register("copyrightStatus")}
              className={cn(
                "w-full rounded-lg border bg-white px-3 py-2.5 text-sm transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400",
                errors.copyrightStatus
                  ? "border-red-300 focus:ring-red-500/30"
                  : "border-slate-300",
              )}
            >
              <option value="">-- 请选择版权状态 --</option>
              {(
                Object.entries(COPYRIGHT_LABELS) as [
                  CopyrightStatusEnum,
                  string,
                ][]
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <FieldError message={errors.copyrightStatus?.message} />
          </div>

          {/* Copyright Agreement */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                {...register("copyrightAgreed")}
                className="mt-0.5 h-4 w-4 rounded border-amber-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <p className="text-sm font-medium text-amber-800">
                  <ShieldCheck className="mr-1 inline h-4 w-4" />
                  版权声明
                </p>
                <p className="mt-1 text-xs text-amber-600 leading-relaxed">
                  我确认所提交的资源符合版权法规。如果为原创内容，我授权本平台使用；如果为转载内容，我已获得授权或仅提供外部链接。我了解虚假声明可能导致内容被下架。
                </p>
              </div>
            </label>
            <FieldError message={errors.copyrightAgreed?.message} />
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className={cn(
            "mt-8 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all",
            "bg-blue-600 hover:bg-blue-700 active:scale-[0.98]",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
          )}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              提交中...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Send className="h-4 w-4" />
              提交投稿
            </span>
          )}
        </button>
      </form>
    </div>
  );
}
