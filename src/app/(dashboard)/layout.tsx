"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { QiushiMark } from "@/components/qiushi-mark";
import { NewUserGuideBanner } from "@/components/new-user-guide";
import {
  LayoutDashboard, BookOpen, FileText,
  Settings, LogOut, Menu, X, ChevronDown, User, Send,
  ClipboardList, Upload, Compass,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/courses", label: "课程库", icon: BookOpen },
  { href: "/contribute", label: "投稿", icon: Send },
  { href: "/resources", label: "学习资料", icon: FileText },
  { href: "/guide", label: "新手引导", icon: Compass },
  { href: "/settings", label: "设置", icon: Settings },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const { data: programsData, isLoading: programsLoading } = useQuery({
    queryKey: ["my-programs"],
    queryFn: () => api.get("/api/me/programs"),
    enabled: isAuthenticated,
  });
  const hasProgram = programsData && Array.isArray(programsData) && (programsData as Array<unknown>).length > 0;

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/login");
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    // /program/* 是"先看看培养方案"预览页、/course/* 是课程详情页，
    // 未选专业的新用户也能浏览，需豁免此守卫（否则预览时点课程会被弹回 onboarding）
    const isProgramPreview = pathname.startsWith("/program") || pathname.startsWith("/course");
    if (!isLoading && !programsLoading && isAuthenticated && !hasProgram && pathname !== "/onboarding" && pathname !== "/guide" && !isProgramPreview) {
      router.replace("/onboarding");
    }
  }, [isLoading, programsLoading, isAuthenticated, hasProgram, pathname, router]);

  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  if (isLoading || programsLoading) {
    return (
      <div className="app-loading flex min-h-screen items-center justify-center">
        <QiushiMark className="h-[50.4px] w-[50.4px] animate-pulse text-blue-600" />
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;

  return (
    <div className="app-shell flex min-h-screen">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-slate-950/35 backdrop-blur-[2px] lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`app-sidebar fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="app-brand flex h-[72px] items-center gap-3.5 px-5">
          <div className="app-brand-mark flex h-[50.4px] w-[50.4px] items-center">
            <QiushiMark className="h-[50.4px] w-[50.4px] text-blue-700" />
          </div>
          <span className="app-brand-title text-[19px] font-bold tracking-tight text-slate-950">求是学径</span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <a key={item.href} href={item.href}
                className={`app-nav-link ${active ? "is-active" : ""} flex min-h-[52px] items-center gap-3.5 px-4 text-lg font-semibold`}>
                <Icon className="h-5 w-5 shrink-0" />
                <span>{item.label}</span>
              </a>
            );
          })}

          {user.role === "ADMIN" && (
            <>
              <div className="mx-2 my-4 border-t border-slate-200" />
              <p className="mx-4 mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">管理</p>
              {[{ href: "/admin/review", label: "审核队列", icon: ClipboardList }, { href: "/admin/import", label: "培养方案导入", icon: Upload }, { href: "/admin/course-corrections", label: "课程修正", icon: BookOpen }].map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <a key={item.href} href={item.href}
                    className={`app-nav-link ${active ? "is-active" : ""} flex min-h-[52px] items-center gap-3.5 px-4 text-lg font-semibold`}>
                    <Icon className="h-5 w-5 shrink-0" />
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </>
          )}
        </nav>

        <div className="app-sidebar-footer mx-4 border-t border-slate-200 px-1 py-4">
          <p className="text-[11px] tracking-wide text-slate-400">
            求是学径 <span className="novecento-number">v0.1</span> · ZJU
          </p>
        </div>
      </aside>

      {/* Main area */}
      <div className="min-w-0 flex flex-1 flex-col">
        {/* Header */}
        <header className="app-topbar sticky top-0 z-20 flex h-16 items-center justify-between px-4 lg:px-8">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="app-icon-button flex h-10 w-10 items-center justify-center text-slate-600 lg:hidden">
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="relative ml-auto">
            <button onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="app-user-button flex min-h-10 items-center gap-2.5 px-2.5 text-sm text-slate-600">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200/70">
                {user.avatar ? (
                  <img src={user.avatar} alt="我的头像" className="h-7 w-7 rounded-full object-cover" />
                ) : user.username.charAt(0).toUpperCase()}
              </div>
              <span className="hidden sm:inline">{user.username}</span>
              <ChevronDown className={`h-3 w-3 text-slate-400 transition ${userMenuOpen ? "rotate-180" : ""}`} />
            </button>
            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                <div className="app-user-menu absolute right-0 top-full z-20 mt-2 w-44 border border-slate-200 bg-white py-1">
                  <div className="border-b border-slate-100 px-3 py-2.5">
                    <p className="text-sm font-medium text-slate-800">{user.username}</p>
                    <p className="text-xs text-slate-400">{user.role === "ADMIN" ? "管理员" : "学生"}</p>
                  </div>
                  <button onClick={() => { setUserMenuOpen(false); logout(); router.replace("/login"); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                    <LogOut className="h-3.5 w-3.5" />退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="app-main flex-1">
          <div className="app-content mx-auto w-full max-w-[1440px] px-4 py-5 lg:px-8 lg:py-8">
            <NewUserGuideBanner userId={user.id} pathname={pathname} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
