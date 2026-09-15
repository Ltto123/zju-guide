import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  websiteImportJob: { findMany: vi.fn() },
  resource: { findUnique: vi.fn() },
}));
const auth = vi.hoisted(() => ({ requireRole: vi.fn(), requireAuth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireRole: auth.requireRole,
  requireAuth: auth.requireAuth,
}));
import { GET } from "@/app/api/admin/website-imports/route";
import { PATCH } from "@/app/api/resources/[id]/route";
import { AuthError } from "@/lib/auth";
import { importBody } from "@/lib/website-import-http";
beforeEach(() => {
  vi.resetAllMocks();
  process.env.WEBSITE_IMPORT_ENABLED = "true";
});
describe("administrator import access", () => {
  it.each(['P2021', 'P2022'])("reports missing schema %s as a deployment problem", async (code) => {
    auth.requireRole.mockResolvedValue({ userId: 'admin' });
    db.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    db.websiteImportJob.findMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'private database details', { code, clientVersion: '6.5.0' },
    ));
    const result = await GET(new NextRequest('http://localhost/api/admin/website-imports'));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: {
      code: 'IMPORT_SCHEMA_NOT_READY',
      message: '网站导入的数据结构尚未更新，请联系管理员完成数据库升级后重试',
    } });
  });
  it("prevents editing a withdrawn batch back into the pending queue", async () => {
    auth.requireAuth.mockResolvedValue({userId:'admin'});
    db.resource.findUnique.mockResolvedValue({submitterId:'admin',importBatch:{status:'WITHDRAWN'}});
    const result = await PATCH(new NextRequest('http://localhost/api/resources/id',{method:'PATCH',body:'{}'}),{params:Promise.resolve({id:'11111111-1111-4111-8111-111111111111'})});
    expect(result.status).toBe(409);
  });
  it("preserves imported source URLs against ordinary resource edits", async () => {
    auth.requireAuth.mockResolvedValue({userId:'admin'});
    db.resource.findUnique.mockResolvedValue({submitterId:'admin',importBatchId:'batch',url:'https://zju-turing.github.io/TuringCourses/major/data_structure/'});
    const result = await PATCH(new NextRequest('http://localhost/api/resources/id',{method:'PATCH',body:JSON.stringify({title:'课程链接',type:'BLOG',applicableStage:'COURSE',url:'https://example.com/other'})}),{params:Promise.resolve({id:'11111111-1111-4111-8111-111111111111'})});
    expect(result.status).toBe(400);
    expect((await result.json()).error.code).toBe('IMPORT_SOURCE_FIXED');
  });
  it("rejects an ordinary user before reading jobs", async () => {
    auth.requireRole.mockRejectedValue(new AuthError("FORBIDDEN", "admin only", 403));
    expect((await GET(new NextRequest("http://localhost/api/admin/website-imports"))).status).toBe(
      403,
    );
    expect(db.websiteImportJob.findMany).not.toHaveBeenCalled();
  });
  it("checks current role rather than trusting a stale admin token", async () => {
    auth.requireRole.mockResolvedValue({ userId: "former-admin" });
    db.user.findUnique.mockResolvedValue({ role: "VISITOR" });
    expect((await GET(new NextRequest("http://localhost/api/admin/website-imports"))).status).toBe(
      403,
    );
  });
  it("keeps imports disabled until the feature switch is set", async () => {
    delete process.env.WEBSITE_IMPORT_ENABLED;
    auth.requireRole.mockResolvedValue({ userId: "admin" });
    db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    expect((await GET(new NextRequest("http://localhost/api/admin/website-imports"))).status).toBe(
      503,
    );
    expect(db.websiteImportJob.findMany).not.toHaveBeenCalled();
  });
  it("returns supported sources and durable jobs to administrators", async () => {
    auth.requireRole.mockResolvedValue({ userId: "admin" });
    db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    db.websiteImportJob.findMany.mockResolvedValue([{ id: "persisted" }]);
    const result = await GET(new NextRequest("http://localhost/api/admin/website-imports"));
    expect(result.status).toBe(200);
    expect((await result.json()).data.jobs).toEqual([{ id: "persisted" }]);
  });
  it("rejects oversized JSON even without a Content-Length header", async () => {
    await expect(
      importBody(
        new NextRequest("http://localhost/api/admin/website-imports", {
          method: "POST",
          body: JSON.stringify({ value: "x".repeat(40000) }),
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
});
