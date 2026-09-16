import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AuthError, requireRole } from "./auth";
import { prisma } from "./prisma";
import { ImportError } from "./website-import-policy";

export async function importAdmin(request: NextRequest) {
  const { userId } = await requireRole(request, "ADMIN");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== "ADMIN") throw new ImportError("管理员权限已失效", 403, "FORBIDDEN");
  if (process.env.WEBSITE_IMPORT_ENABLED !== "true")
    throw new ImportError("网站导入尚未启用", 503, "IMPORT_DISABLED");
  return userId;
}
export async function importBody(request: NextRequest) {
  // Bound streamed bodies as well as Content-Length (which is untrusted).
  const reader = request.body?.getReader();
  if (!reader) throw new ImportError("请求内容为空");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 32768) {
      await reader.cancel();
      throw new ImportError("请求过大", 413);
    }
    chunks.push(value);
  }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Object required");
    return data as Record<string, unknown>;
  } catch {
    throw new ImportError("无效的 JSON");
  }
}
export function importFailure(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2021', 'P2022'].includes(error.code)
  ) {
    console.error('Website import schema not ready:', error.code,
      'Apply prisma migrate deploy against the app database, then restart app and worker.');
    return NextResponse.json({ error: {
      code: 'IMPORT_SCHEMA_NOT_READY',
      message: '网站导入的数据结构尚未更新，请联系管理员完成数据库升级后重试',
    } }, { status: 503 });
  }
  if (error instanceof ImportError || error instanceof AuthError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "请检查标题、分类及课程字段" } },
      { status: 400 },
    );
  console.error("Website import API error", error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "导入服务暂不可用" } },
    { status: 500 },
  );
}
