"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { BookOpen, Search } from "lucide-react";
import Link from "next/link";

export default function CoursesPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["courses", search, page],
    queryFn: () =>
      api.rawGet<{
        data: { code: string; name: string; credits: number; department: string; semester: string }[];
        pagination: { total: number; page: number; pageSize: number };
      }>(`/api/courses?search=${encodeURIComponent(search)}&page=${page}&pageSize=20`),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <BookOpen className="h-6 w-6 text-blue-600" />
        <h2 className="text-xl font-bold text-slate-900">课程库</h2>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="搜索课程名称或课号..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {isLoading && <div className="text-center text-sm text-slate-400">加载中...</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">加载失败</div>}

      {data && (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">课号</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">课程名称</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">学分</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">开课单位</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">建议学期</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.data.map((course) => (
                  <tr key={course.code} className="transition hover:bg-slate-50">
                    <td className="course-code px-4 py-3 text-blue-600">{course.code}</td>
                    <td className="px-4 py-3">
                      <Link href={`/course/${course.code}`} className="font-medium text-slate-900 hover:text-blue-600">
                        {course.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{course.credits}</td>
                    <td className="px-4 py-3 text-slate-500">{course.department}</td>
                    <td className="px-4 py-3 text-slate-500">{course.semester}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>共 {data.pagination.total} 门课程</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border px-3 py-1.5 disabled:opacity-30"
              >
                上一页
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page * data.pagination.pageSize >= data.pagination.total}
                className="rounded-lg border px-3 py-1.5 disabled:opacity-30"
              >
                下一页
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
