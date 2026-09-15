import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() }, $transaction: vi.fn() }));
const auth = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireRole: auth.requireRole }));
import { POST } from "@/app/api/admin/submissions/bulk-approve/route";
import { AuthError } from "@/lib/auth";
const id = "11111111-1111-4111-8111-111111111111";
const tx = { $executeRaw: vi.fn(), submission: { findUnique: vi.fn(), update: vi.fn() }, resource: { update: vi.fn() }, auditLog: { create: vi.fn() } };
const request = (body: unknown) => new NextRequest("http://localhost/api/admin/submissions/bulk-approve", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.WEBSITE_IMPORT_ENABLED;
  auth.requireRole.mockResolvedValue({ userId: "admin" });
  db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  db.$transaction.mockImplementation((fn) => fn(tx));
  tx.submission.findUnique.mockResolvedValue({ id, result: null, resourceId: "resource", resource: { status: "DRAFT", importBatch: null } });
});
it("requires token and current administrator role", async () => {
  auth.requireRole.mockRejectedValueOnce(new AuthError("UNAUTHORIZED", "sign in"));
  expect((await POST(request({ submissionIds: [id] }))).status).toBe(401);
  db.user.findUnique.mockResolvedValue({ role: "VISITOR" });
  expect((await POST(request({ submissionIds: [id] }))).status).toBe(403);
  expect(db.$transaction).not.toHaveBeenCalled();
});
it.each([[], Array(101).fill(id), ["bad"], [id, id]])("rejects invalid selection %j", async (submissionIds) => {
  expect((await POST(request({ submissionIds }))).status).toBe(400);
  expect(db.$transaction).not.toHaveBeenCalled();
});
it("approves ordinary submissions with imports disabled and writes one audit under lock", async () => {
  const response = await POST(request({ submissionIds: [id] }));
  expect(response.status).toBe(200);
  expect((await response.json()).data.results).toEqual([{ id, status: "APPROVED" }]);
  expect(tx.$executeRaw.mock.calls[0]?.[0][0]).toContain("830809");
  expect(tx.$executeRaw.mock.invocationCallOrder[0]!).toBeLessThan(tx.submission.findUnique.mock.invocationCallOrder[0]!);
  expect(tx.resource.update).toHaveBeenCalledWith({ where: { id: "resource" }, data: { status: "APPROVED" } });
  expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
});
it.each([
  [null, "NOT_FOUND"],
  [{ result: "REJECTED", resource: { status: "REJECTED" } }, "NOT_PENDING"],
  [{ result: "APPROVED", resource: { status: "APPROVED" } }, "ALREADY_APPROVED"],
  [{ result: "APPROVED", resource: { status: "HIDDEN", importBatch: { status: "WITHDRAWN" } } }, "WITHDRAWN"],
  [{ result: null, resource: { status: "HIDDEN" } }, "NOT_PENDING"],
])("preserves previous decisions and withdrawn resources", async (row, status) => {
  tx.submission.findUnique.mockResolvedValue(row);
  expect((await (await POST(request({ submissionIds: [id] }))).json()).data.results).toEqual([{ id, status }]);
  expect(tx.submission.update).not.toHaveBeenCalled();
  expect(tx.resource.update).not.toHaveBeenCalled();
  expect(tx.auditLog.create).not.toHaveBeenCalled();
});
it("reports a failed item and continues separate transactions", async () => {
  db.$transaction.mockRejectedValueOnce(new Error("db failure"));
  const other = "22222222-2222-4222-8222-222222222222";
  const response = await POST(request({ submissionIds: [id, other] }));
  expect((await response.json()).data.results).toEqual([{ id, status: "FAILED" }, { id: other, status: "APPROVED" }]);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
});
it("bounds streamed JSON", async () => {
  expect((await POST(request({ submissionIds: [id], padding: "x".repeat(40000) }))).status).toBe(413);
});
