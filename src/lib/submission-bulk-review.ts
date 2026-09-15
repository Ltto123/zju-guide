import { prisma } from "./prisma";

export type BulkReviewStatus = "APPROVED" | "ALREADY_APPROVED" | "NOT_FOUND" | "NOT_PENDING" | "WITHDRAWN" | "FAILED";
export interface BulkReviewResult { id: string; status: BulkReviewStatus }

/** One transaction per item allows useful progress without hiding individual failures. */
export async function bulkApproveSubmissions(submissionIds: string[], userId: string) {
  const results: BulkReviewResult[] = [];
  for (const id of submissionIds) {
    try {
      const status = await prisma.$transaction(async (tx): Promise<BulkReviewStatus> => {
        // Same lock as single review and batch withdrawal. Re-read only after acquiring it.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(830809)`;
        const current = await tx.submission.findUnique({ where: { id }, include: { resource: { include: { importBatch: true } } } });
        if (!current) return "NOT_FOUND";
        if (current.resource.importBatch?.status === "WITHDRAWN") return "WITHDRAWN";
        if (current.result === "APPROVED") return "ALREADY_APPROVED";
        if (current.result !== null || current.resource.status !== "DRAFT") return "NOT_PENDING";
        await tx.submission.update({ where: { id }, data: { result: "APPROVED", reviewerId: userId, reviewedAt: new Date(), reason: null } });
        await tx.resource.update({ where: { id: current.resourceId }, data: { status: "APPROVED" } });
        await tx.auditLog.create({ data: { userId, action: "RESOURCE_APPROVED", targetType: "Resource", targetId: current.resourceId, detail: "审核结果: APPROVED（批量审核）" } });
        return "APPROVED";
      });
      results.push({ id, status });
    } catch {
      results.push({ id, status: "FAILED" });
    }
  }
  return results;
}
