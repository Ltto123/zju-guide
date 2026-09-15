import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { scanSource, matchCourses, canonicalizeUrl, resolveSource, type WebsiteLink } from "./website-sources";
import { importTransaction } from "./website-import-service";

export async function runImportOnce(scanner = scanSource): Promise<boolean> {
  if (process.env.WEBSITE_IMPORT_ENABLED !== "true") return false;
  const token = randomUUID();
  const job = await importTransaction(async (tx) => {
    const next = await tx.websiteImportJob.findFirst({
      where: {
        OR: [{ status: "QUEUED" }, { status: "RUNNING", leaseExpiresAt: { lt: new Date() } }],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!next) return null;
    return tx.websiteImportJob.update({
      where: { id: next.id },
      data: { status: "RUNNING", leaseToken: token, leaseExpiresAt: new Date(Date.now() + 90000) },
    });
  });
  if (!job) return false;
  const source = resolveSource(job.sourceId);
  const heartbeat = setInterval(() => {
    void prisma.websiteImportJob
      .updateMany({
        where: { id: job.id, leaseToken: token, status: "RUNNING" },
        data: { leaseExpiresAt: new Date(Date.now() + 90000) },
      })
      .catch((e) => console.error("Import lease heartbeat failed", e));
  }, 20000);
  try {
    const courses = await prisma.course.findMany({ select: { code: true, name: true } });
    const existing = await prisma.resource.findMany({
      where: { url: { not: null } },
      select: { id: true, url: true },
    });
    const known = new Map(
      existing.flatMap((r) => {
        try {
          return [[canonicalizeUrl(r.url!), r.id]] as [string, string][];
        } catch {
          return [];
        }
      }),
    );
    const stopped = async () =>
      !(await prisma.websiteImportJob.count({
        where: { id: job.id, leaseToken: token, status: "RUNNING" },
      }));
    const persist = async (
      items: WebsiteLink[],
      scanned: number,
      errors: string[],
    ) => {
      await importTransaction(async (tx) => {
        const active = await tx.websiteImportJob.count({
          where: { id: job.id, leaseToken: token, status: "RUNNING" },
        });
        if (!active) return;
        for (const item of items.slice(0, 30)) {
          const canonicalUrl = canonicalizeUrl(item.url),
            match = matchCourses(item.title, courses),
            duplicate = known.get(canonicalUrl);
          await tx.websiteImportCandidate.upsert({
            where: { jobId_canonicalUrl: { jobId: job.id, canonicalUrl } },
            update: {},
            create: {
              jobId: job.id,
              title: item.title.slice(0, 120),
              url: canonicalUrl,
              canonicalUrl,
              summary: `来自${source.name}的${item.title}学习资料入口。`.slice(0, 500),
              resourceScope: item.resourceScope || 'COURSE',
              courseCodes: item.resourceScope === 'GENERAL' ? [] : match.courseCodes,
              matchReason: item.resourceScope === 'GENERAL' ? '网站首页：通用资源入口' : match.matchReason,
              status: duplicate ? "DUPLICATE" : "READY",
              duplicateResourceId: duplicate,
            },
          });
        }
        await tx.websiteImportJob.update({
          where: { id: job.id },
          data: { scanned, error: errors.length ? errors.join("\n").slice(0, 4000) : null },
        });
      });
    };
    const result = await scanner(job.sourceId, { onProgress: persist, isCancelled: stopped });
    await persist(result.items, result.scanned, result.errors);
    await prisma.websiteImportJob.updateMany({
      where: { id: job.id, status: "RUNNING", leaseToken: token },
      data: {
        status: result.items.length ? "COMPLETED" : "FAILED",
        error: result.errors.length
          ? result.errors.join("\n").slice(0, 4000)
          : result.items.length
            ? null
            : "没有发现可导入课程页，请检查来源目录",
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  } catch (error) {
    await prisma.websiteImportJob.updateMany({
      where: { id: job.id, status: "RUNNING", leaseToken: token },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message.slice(0, 1000) : "扫描失败",
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
