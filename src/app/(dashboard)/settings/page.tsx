"use client";

import { Settings, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-blue-600" />
        <h2 className="text-xl font-bold text-slate-900">设置</h2>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100">
            <User className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{user?.username}</h3>
            <p className="text-sm text-slate-500">
              角色：{user?.role === "ADMIN" ? "管理员" : user?.role === "CONTRIBUTOR" ? "贡献者" : "学生"}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 font-semibold text-slate-900">关于求是学径</h3>
        <div className="space-y-2 text-sm text-slate-600">
          <p>版本：v0.1.0</p>
          <p>技术栈：Next.js 15 + TypeScript + Prisma + Tailwind CSS</p>
          <p>浙江大学软件工程课程实践项目 · 2026</p>
        </div>
      </div>
    </div>
  );
}
