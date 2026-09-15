import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { WEBSITE_SOURCES } from "@/lib/website-sources";
import { createImportJob } from "@/lib/website-import-service";
import { importAdmin, importBody, importFailure } from "@/lib/website-import-http";
import { ImportError } from "@/lib/website-import-policy";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    await importAdmin(request);
    const jobs = await prisma.websiteImportJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ data: { enabled: true, sources: WEBSITE_SOURCES, jobs } });
  } catch (e) {
    return importFailure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    const userId = await importAdmin(request);
    const body = await importBody(request);
    if (typeof body.sourceId !== "string" || body.sourceId.length > 2048)
      throw new ImportError("请选择来源");
    if (body.mode !== undefined && body.mode !== 'site') throw new ImportError('无效导入方式');
    const entry = body.mode === 'site' ? {
      title: typeof body.title === 'string' ? body.title : body.sourceId.slice(0,120),
      summary: typeof body.summary === 'string' ? body.summary : '网站通用资源入口（未自动核验站内内容）',
    } : undefined;
    return NextResponse.json(
      { data: await createImportJob(userId, body.sourceId, entry) },
      { status: 201 },
    );
  } catch (e) {
    return importFailure(e);
  }
}
