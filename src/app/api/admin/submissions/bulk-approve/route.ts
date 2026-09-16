import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { importBody } from "@/lib/website-import-http";
import { ImportError } from "@/lib/website-import-policy";
import { bulkApproveSubmissions } from "@/lib/submission-bulk-review";

const schema = z.object({ submissionIds: z.array(z.string().uuid()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length) }).strict();

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireRole(request, "ADMIN");
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== "ADMIN") throw new AuthError("FORBIDDEN", "管理员权限已失效", 403);
    // importBody only bounds/parses JSON; general review has no import feature gate.
    const { submissionIds } = schema.parse(await importBody(request));
    return NextResponse.json({ data: { results: await bulkApproveSubmissions(submissionIds, userId) } });
  } catch (error) {
    if (error instanceof AuthError || error instanceof ImportError)
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "请选择 1–100 个不同的有效投稿" } }, { status: 400 });
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "审核服务暂不可用" } }, { status: 500 });
  }
}
