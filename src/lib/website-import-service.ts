import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { canonicalizeUrl, resolveSource } from "./website-sources";
import { assertAllowedUrl } from './website-fetch';
import {
  candidateUpdateSchema,
  ImportError,
  importDayStart,
  selectionSchema,
} from "./website-import-policy";

// All import mutations share a PostgreSQL transaction lock. Network fetching is
// deliberately outside transactions. This also serializes quota and duplicate checks.
export async function importTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(830809)`;
      return work(tx);
    },
    { maxWait: 15000, timeout: 20000 },
  );
}
async function administrator(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== "ADMIN") throw new ImportError("仅管理员可使用网站导入", 403, "FORBIDDEN");
}
async function mutableJob(tx: Prisma.TransactionClient, jobId: string) {
  const job = await tx.websiteImportJob.findUnique({ where: { id: jobId } });
  if (!job) throw new ImportError("导入任务不存在", 404);
  if (["CANCELLED", "WITHDRAWN"].includes(job.status))
    throw new ImportError("任务已取消或撤回", 409);
  return job;
}
export async function createImportJob(userId: string, input: string, entry?: { title: string; summary: string }) {
  let source;
  try {
    source = resolveSource(input);
  } catch {
    throw new ImportError("请输入完整的公开 HTTP/HTTPS 网址，或选择预置网站名称");
  }
  return importTransaction(async (tx) => {
    await administrator(tx, userId);
    if (
      (await tx.websiteImportJob.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) >= 3
    )
      throw new ImportError("最多同时保留 3 个扫描任务，请等待完成", 429);
    if (
      (await tx.websiteImportJob.count({
        where: { ownerId: userId, createdAt: { gte: importDayStart() } },
      })) >= 20
    )
      throw new ImportError("每日最多创建 20 个扫描任务", 429);
    const siteData = entry ? candidateUpdateSchema.parse({ ...entry, resourceScope:'GENERAL',
      type:'BLOG', applicableStage:'COURSE', courseCodes:[] }) : null;
    const url = source.startUrl || source.baseUrl;
    return tx.websiteImportJob.create({ data: { sourceId: source.id, ownerId: userId,
      ...(siteData ? { status:'COMPLETED', candidates:{create:{...siteData,url,canonicalUrl:canonicalizeUrl(url),
        matchReason:'管理员提供的网站入口；未自动核验站内内容',confirmed:false}} } : {}),
    } });
  });
}
export async function getImportJob(id: string) {
  const job = await prisma.websiteImportJob.findUnique({
    where: { id },
    include: { candidates: { orderBy: { createdAt: "asc" } } },
  });
  if (!job) throw new ImportError("导入任务不存在", 404);
  const codes = [
    ...new Set(
      job.candidates.flatMap((c) =>
        Array.isArray(c.courseCodes)
          ? c.courseCodes.filter((v): v is string => typeof v === "string")
          : [],
      ),
    ),
  ];
  const courses = await prisma.course.findMany({
    where: { code: { in: codes } },
    select: { code: true, name: true },
  });
  const courseLabels = Object.fromEntries(courses.map((c) => [c.code, c.name]));
  return { ...job, candidates: job.candidates.map((c) => ({ ...c, courseLabels })) };
}
export async function updateCandidate(
  userId: string,
  jobId: string,
  candidateId: string,
  input: unknown,
) {
  const data = candidateUpdateSchema.parse(input);
  return importTransaction(async (tx) => {
    await administrator(tx, userId);
    await mutableJob(tx, jobId);
    const item = await tx.websiteImportCandidate.findFirst({ where: { id: candidateId, jobId } });
    if (!item || ["SUBMITTED", "DUPLICATE"].includes(item.status))
      throw new ImportError("候选不存在或已经处理", 409);
    const count = await tx.course.count({ where: { code: { in: data.courseCodes } } });
    if (count !== data.courseCodes.length) throw new ImportError("关联课程不存在，请重新选择");
    await tx.websiteImportCandidate.update({
      where: { id: candidateId },
      data: { ...data, confirmed: true, status: "READY", error: null },
    });
  });
}
type SubmissionResult = {
  candidateId: string;
  status: string;
  resourceId?: string;
  error?: string;
};
export async function submitReadyCandidates(userId: string, jobId: string, includeUnmatchedAsGeneral = false) {
  const prepared = await importTransaction(async tx => {
    await administrator(tx, userId);
    const job = await mutableJob(tx, jobId);
    if (job.status !== 'COMPLETED') throw new ImportError('请等待扫描完成后再一键投稿',409);
    const candidates = await tx.websiteImportCandidate.findMany({where:{jobId,status:{in:['READY','FAILED']}},orderBy:{createdAt:'asc'}});
    const ids: string[]=[];
    let skipped=0;
    for (const c of candidates) {
      const codes=Array.isArray(c.courseCodes)?c.courseCodes:[];
      const fallback = includeUnmatchedAsGeneral && !c.confirmed && c.resourceScope !== 'GENERAL' && codes.length !== 1;
      if (!(fallback || c.confirmed || c.resourceScope==='GENERAL' || codes.length===1)) {skipped++;continue;}
      const parsed=candidateUpdateSchema.safeParse(fallback ? {...c,resourceScope:'GENERAL',courseCodes:[]} : c);
      if (!parsed.success || ids.length>=30) {skipped++;continue;}
      if (await tx.course.count({where:{code:{in:parsed.data.courseCodes}}})!==parsed.data.courseCodes.length) {skipped++;continue;}
      await tx.websiteImportCandidate.update({where:{id:c.id},data:{...parsed.data,confirmed:true,status:'READY',error:null}});
      ids.push(c.id);
    }
    return {ids,skipped};
  });
  if (!prepared.ids.length) return {results:[],skipped:prepared.skipped};
  return {...await submitCandidates(userId,jobId,prepared.ids),skipped:prepared.skipped};
}
export async function submitCandidates(userId: string, jobId: string, ids: string[]) {
  const { candidateIds } = selectionSchema.parse({ candidateIds: ids });
  const job = await getImportJob(jobId);
  if (["CANCELLED", "WITHDRAWN"].includes(job.status))
    throw new ImportError("任务已取消或撤回", 409);
  const results: SubmissionResult[] = [];
  for (const candidateId of candidateIds) {
    try {
      results.push(
        await importTransaction(async (tx) => {
          await administrator(tx, userId);
          const batch = await mutableJob(tx, jobId);
          const item = await tx.websiteImportCandidate.findFirst({
            where: { id: candidateId, jobId },
          });
          if (!item) throw new ImportError("候选不属于该任务");
          if (item.status === "SUBMITTED" && item.resourceId)
            return { candidateId, status: "SUBMITTED", resourceId: item.resourceId };
          if (item.status === "DUPLICATE")
            return {
              candidateId,
              status: "DUPLICATE",
              resourceId: item.duplicateResourceId ?? undefined,
            };
          if (!item.confirmed) throw new ImportError("请先保存并确认课程关联");
          const data = candidateUpdateSchema.parse(item);
          const source = resolveSource(batch.sourceId);
          assertAllowedUrl(item.url, source.baseUrl);
          const canonicalUrl = canonicalizeUrl(item.url);
          if (
            (await tx.course.count({ where: { code: { in: data.courseCodes } } })) !==
            data.courseCodes.length
          )
            throw new ImportError("关联课程不存在");
          // Also recognizes old manually submitted URLs, which have no import key.
          const existing = await tx.resource.findMany({
            where: { url: { not: null } },
            select: { id: true, url: true },
          });
          const duplicate = existing.find((r) => {
            try {
              return canonicalizeUrl(r.url!) === canonicalUrl;
            } catch {
              return false;
            }
          });
          if (duplicate) {
            await tx.websiteImportCandidate.update({
              where: { id: candidateId },
              data: { status: "DUPLICATE", duplicateResourceId: duplicate.id, error: null },
            });
            return { candidateId, status: "DUPLICATE", resourceId: duplicate.id };
          }
          const daily = await tx.auditLog.count({
            where: {
              userId,
              action: "WEBSITE_IMPORT_SUBMITTED",
              createdAt: { gte: importDayStart() },
            },
          });
          if (daily >= 100) throw new ImportError("今日批量投稿已达 100 条上限", 429);
          const resource = await tx.resource.create({
            data: {
              title: data.title,
              type: data.type,
              summary: data.summary,
              url: canonicalUrl,
              applicableStage: data.applicableStage,
              copyrightStatus: "EXTERNAL_LINK",
              status: "DRAFT",
              submitterId: userId,
              sourceSite: source.name,
              sourcePage: canonicalUrl,
              discoveredAt: item.createdAt,
              importBatchId: jobId,
              importUrlKey: canonicalUrl,
              courseResources: { create: data.courseCodes.map((courseCode) => ({ courseCode })) },
              submissions: { create: { submitterId: userId } },
            },
          });
          await tx.websiteImportCandidate.update({
            where: { id: candidateId },
            data: {
              status: "SUBMITTED",
              resourceId: resource.id,
              submittedAt: new Date(),
              error: null,
            },
          });
          await tx.auditLog.create({
            data: {
              userId,
              action: "WEBSITE_IMPORT_SUBMITTED",
              targetType: "Resource",
              targetId: resource.id,
              detail: `batch=${jobId}`,
            },
          });
          return { candidateId, status: "SUBMITTED", resourceId: resource.id };
        }),
      );
    } catch (error) {
      if (
        !(error instanceof ImportError) &&
        !(error instanceof Prisma.PrismaClientKnownRequestError)
      )
        console.error("Website import submit failed", error);
      const message = error instanceof ImportError ? error.message : "提交失败，可重试";
      // Do not overwrite an item successfully submitted by a concurrent request.
      await prisma.websiteImportCandidate.updateMany({
        where: {
          id: candidateId,
          jobId,
          status: { in: ["READY", "FAILED"] },
          job: { status: { notIn: ["CANCELLED", "WITHDRAWN"] } },
        },
        data: { status: "FAILED", error: message },
      });
      results.push({ candidateId, status: "FAILED", error: message });
    }
  }
  return { results };
}
export async function cancelJob(userId: string, jobId: string) {
  await importTransaction(async (tx) => {
    await administrator(tx, userId);
    const job = await mutableJob(tx, jobId);
    if (!["QUEUED", "RUNNING"].includes(job.status)) throw new ImportError("扫描已结束", 409);
    await tx.websiteImportJob.update({
      where: { id: jobId },
      data: { status: "CANCELLED", leaseToken: null, leaseExpiresAt: null },
    });
  });
}
export async function withdrawBatch(userId: string, jobId: string) {
  await importTransaction(async (tx) => {
    await administrator(tx, userId);
    const job = await tx.websiteImportJob.findUnique({ where: { id: jobId } });
    if (!job) throw new ImportError("任务不存在", 404);
    if (job.status === "WITHDRAWN") return;
    const resourceIds = (
      await tx.resource.findMany({ where: { importBatchId: jobId }, select: { id: true } })
    ).map((r) => r.id);
    await tx.resource.updateMany({
      where: { id: { in: resourceIds } },
      data: { status: "REJECTED" },
    });
    await tx.submission.updateMany({
      where: { resourceId: { in: resourceIds } },
      data: {
        result: "REJECTED",
        reviewerId: userId,
        reviewedAt: new Date(),
        reason: "来源导入批次已撤回",
      },
    });
    await tx.websiteImportJob.update({
      where: { id: jobId },
      data: { status: "WITHDRAWN", leaseToken: null, leaseExpiresAt: null },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "WEBSITE_IMPORT_WITHDRAWN",
        targetType: "WebsiteImportJob",
        targetId: jobId,
        detail: JSON.stringify({ resourceIds }),
      },
    });
  });
}
