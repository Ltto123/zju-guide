"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { FileText, Search, ExternalLink } from "lucide-react";

import { RESOURCE_TYPE_LABELS } from "@/lib/constants";

export default function ResourcesPage() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ results: { type: string; title: string; url?: string; summary?: string }[] }>({
    queryKey: ["search", search],
    queryFn: () => api.get(`/api/search?q=${encodeURIComponent(search)}`),
    enabled: search.length > 0,
  });

  const results = data?.results ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-blue-600" />
        <h2 className="text-xl font-bold text-slate-900">学习资料</h2>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="搜索资料标题..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {isLoading && <div className="text-center text-sm text-slate-400">搜索中...</div>}

      {data && results.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-12 text-center">
          <Search className="mx-auto mb-4 h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-500">没有找到匹配的资料</p>
        </div>
      )}

      {data && results.length > 0 && (
        <div className="space-y-3">
          {results.map((item, idx) => (
            <div key={idx} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {RESOURCE_TYPE_LABELS[item.type] ?? item.type}
                  </span>
                  <h3 className="mt-2 font-medium text-slate-900">{item.title}</h3>
                  {item.summary && <p className="mt-1 text-sm text-slate-500">{item.summary}</p>}
                </div>
                {item.url && (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-blue-500 hover:text-blue-600">
                    <ExternalLink className="h-4 w-4" />
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
