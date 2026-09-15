import { NextRequest, NextResponse } from "next/server";
import { importAdmin, importBody, importFailure } from "@/lib/website-import-http";
import {
  getImportJob,
  updateCandidate,
  submitCandidates,
  submitReadyCandidates,
  cancelJob,
  withdrawBatch,
} from "@/lib/website-import-service";
import { ImportError, selectionSchema } from "@/lib/website-import-policy";
type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: Context) {
  try {
    await importAdmin(request);
    return NextResponse.json({ data: await getImportJob((await params).id) });
  } catch (e) {
    return importFailure(e);
  }
}
export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const userId = await importAdmin(request),
      { id } = await params,
      body = await importBody(request);
    if (body.action === "cancel") await cancelJob(userId, id);
    else if (body.action === "withdraw") await withdrawBatch(userId, id);
    else if (body.action === "update" && typeof body.candidateId === "string")
      await updateCandidate(userId, id, body.candidateId, body);
    else throw new ImportError("无效操作");
    return NextResponse.json({ data: await getImportJob(id) });
  } catch (e) {
    return importFailure(e);
  }
}
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const userId = await importAdmin(request),
      { id } = await params;
    const body = await importBody(request);
    if (body.action === 'submit-ready') {
      if (body.includeUnmatchedAsGeneral !== undefined && typeof body.includeUnmatchedAsGeneral !== 'boolean') throw new ImportError('无效的通用资源选项');
      return NextResponse.json({data:await submitReadyCandidates(userId,id,body.includeUnmatchedAsGeneral === true)});
    }
    const { candidateIds } = selectionSchema.parse(body);
    return NextResponse.json({ data: await submitCandidates(userId, id, candidateIds) });
  } catch (e) {
    return importFailure(e);
  }
}
