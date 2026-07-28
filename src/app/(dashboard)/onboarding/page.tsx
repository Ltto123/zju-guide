"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { GraduationCap, ArrowRight, Search } from "lucide-react";

interface ProgramData {
  years: { year: number; majors: string[] }[];
  total: number;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [year, setYear] = useState<number | null>(null);
  const [major, setMajor] = useState("");
  const [majorSearch, setMajorSearch] = useState("");

  const { data, isLoading } = useQuery<ProgramData>({
    queryKey: ["programs"],
    queryFn: () => api.get("/api/programs"),
  });

  const selectMutation = useMutation({
    mutationFn: () => api.post("/api/me/programs", { majorName: major, year: year!, type: "MAJOR" }),
    onSuccess: () => router.push("/"),
  });

  const years = data?.years ?? [];
  const selectedYearMajors = year ? years.find((y) => y.year === year)?.majors ?? [] : [];
  const filteredMajors = majorSearch
    ? selectedYearMajors.filter((m) => m.toLowerCase().includes(majorSearch.toLowerCase()))
    : selectedYearMajors;

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-slate-400">加载培养方案列表...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-8 py-12">
      {/* Header */}
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-500/20">
          <GraduationCap className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">欢迎来到求是学径</h1>
        <p className="mt-2 text-sm text-slate-500">
          选择你的入学年级和专业，系统将自动加载对应的培养方案
        </p>
      </div>

      {/* Step 1: Select Year */}
      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700">
          第一步：入学年级
        </label>
        <div className="grid grid-cols-4 gap-2">
          {years.map(({ year: y }) => (
            <button
              key={y}
              onClick={() => { setYear(y); setMajor(""); setMajorSearch(""); }}
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                year === y
                  ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {y} 级
            </button>
          ))}
        </div>
        {years.length === 0 && (
          <p className="text-sm text-slate-400">暂无可选的培养方案。请等待管理员导入数据。</p>
        )}
      </div>

      {/* Step 2: Select Major */}
      {year && (
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">
            第二步：选择专业
          </label>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={majorSearch}
              onChange={(e) => setMajorSearch(e.target.value)}
              placeholder="搜索专业名称..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Major list */}
          <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
            {filteredMajors.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400">没有匹配的专业</p>
            ) : (
              filteredMajors.map((m) => (
                <button
                  key={m}
                  onClick={() => setMajor(m)}
                  className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${
                    major === m
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {m}
                </button>
              ))
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {selectedYearMajors.length} 个专业可用 · 共 {data?.total ?? 0} 个培养方案
          </p>
        </div>
      )}

      {/* Confirm */}
      {year && major && (
        <button
          onClick={() => selectMutation.mutate()}
          disabled={selectMutation.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-500 disabled:opacity-50"
        >
          {selectMutation.isPending ? "加载中..." : `确认：${year}级 ${major}`}
          <ArrowRight className="h-5 w-5" />
        </button>
      )}

      {selectMutation.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {(selectMutation.error as Error).message || "选择失败，请重试"}
        </div>
      )}
    </div>
  );
}
