import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { correctDocumentCourse, listDocumentCourses, matchesCourse } from "@/lib/course-correction-document";
import type { ProgramDocument } from "@/lib/program-document";

export const correctionSchema = z.object({
  mode: z.enum(["program", "search"]),
  programId: z.string().uuid().optional(),
  sourceCode: z.string().trim().min(1).max(100),
  sourceName: z.string().trim().min(1).max(200).optional(),
  targetCode: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "课号只能包含英文字母、数字、下划线或连字符"),
  targetName: z.string().trim().min(1).max(200),
  details: z.object({
    credits: z.number().finite().min(0).max(100),
    department: z.string().trim().max(200),
    category: z.string().trim().max(100),
    description: z.string().trim().max(10000),
    semester: z.string().trim().max(100),
  }).optional(),
  scope: z.enum(["selected", "all", "name", "both"]),
  existingAction: z.enum(["merge_resources", "replace"]).optional(),
  transfer: z.enum(["independent", "migrate"]),
  action: z.enum(["preview", "apply"]),
  fingerprint: z.string().length(64).optional(),
}).superRefine((input, ctx) => {
  if (input.mode === "program" && !input.programId) ctx.addIssue({ code: "custom", message: "请选择培养方案", path: ["programId"] });
  if (input.action === "apply" && !input.fingerprint) ctx.addIssue({ code: "custom", message: "请先预览修改", path: ["fingerprint"] });
  if (["name", "both"].includes(input.scope) && !input.sourceName) ctx.addIssue({ code: "custom", message: "请重新选择课程以读取原课程名称", path: ["sourceName"] });
});
export type CorrectionInput = z.infer<typeof correctionSchema>;

async function prepare(tx: Prisma.TransactionClient, input: CorrectionInput) {
  const scope = input.mode === "search" && input.scope === "selected" ? "all" : input.scope;
  const source = await tx.course.findUnique({ where: { code: input.sourceCode } });
  const allPrograms = await tx.programVersion.findMany({ include: { programCourses: { include: { course: true }, orderBy: { id: "asc" } } }, orderBy: { id: "asc" } });
  // 文档中的名称是方案内显示名称，不能用主表名称覆盖它来匹配。
  const indexed = allPrograms.map(program => {
    const occurrences = listDocumentCourses(program.programJson as unknown as ProgramDocument | null);
    const documented = new Set(occurrences.map(c => c.courseCode));
    for (const relation of program.programCourses) {
      if (!documented.has(relation.courseCode)) occurrences.push({ courseCode: relation.courseCode, courseName: relation.courseNameOverride ?? relation.course.name, credits: relation.course.credits, path: [], semesters: [] });
    }
    return { ...program, occurrences };
  });
  const selected = indexed.find(p => p.id === input.programId);
  const occurrence = selected?.occurrences.find(c => c.courseCode === input.sourceCode && (!input.sourceName || c.courseName === input.sourceName));
  if (input.mode === "program" && !occurrence) throw new AuthError("CONFLICT", "该课程的原课号或名称已不在所选培养方案中，请重新选择", 409);
  if (input.mode === "search" && !source) throw new AuthError("NOT_FOUND", "课程不存在", 404);
  if (input.mode === "search" && input.sourceName && source?.name !== input.sourceName) throw new AuthError("CONFLICT", "原课程名称已变化，请重新选择", 409);
  const sourceName = input.sourceName ?? occurrence?.courseName ?? source?.name ?? "";
  const references = indexed.map(p => ({ ...p, matches: p.occurrences.filter(c => matchesCourse(c, input.sourceCode, sourceName, scope)) })).filter(p => p.matches.length);
  const affectedPrograms = scope === "selected" ? references.filter(p => p.id === input.programId) : references;
  const codeChanged = input.sourceCode !== input.targetCode;
  const target = codeChanged ? await tx.course.findUnique({ where: { code: input.targetCode } }) : null;
  if (target && !input.existingAction) throw new AuthError("CONFLICT", "目标课号已存在，请确认并入并选择合并资源或仅替换课程引用", 409);
  if (!target && input.existingAction) throw new AuthError("CONFLICT", "目标课程已不存在，请重新检查课号", 409);
  const targetName = target?.name ?? input.targetName;
  const details = target ? { credits: target.credits, department: target.department, category: target.category, description: target.description, semester: target.semester } : input.details ? {
    credits: input.details.credits, department: input.details.department || null,
    category: input.details.category || null, description: input.details.description || null, semester: input.details.semester || null,
  } : { credits: source?.credits ?? occurrence?.credits ?? 0, department: source?.department ?? null, category: source?.category ?? null, description: source?.description ?? null, semester: source?.semester ?? null };
  const detailsChanged = !!input.details && Object.entries(details).some(([key, value]) => value !== (source ? source[key as keyof typeof details] : key === "credits" ? occurrence?.credits ?? 0 : null));
  if (!codeChanged && scope !== "all" && detailsChanged) throw new AuthError("VALIDATION_ERROR", "同课号的学分、开课学院等属于课程公共信息，请选择按原课号应用到所有培养方案后修改", 400);
  if (codeChanged) {
    // JSON 中尚未进入课程主表的课号也不能被无意合并。
    if (!target && indexed.some(p => p.occurrences.some(c => c.courseCode === input.targetCode))) {
      throw new AuthError("CONFLICT", "目标课号仅存在于培养方案文档中，尚无课程库信息，请先将该课程同步到课程库", 409);
    }
  } else {
    const unchanged = affectedPrograms.every(p => p.matches.every(c => c.courseCode === input.targetCode && c.courseName === targetName));
    if (!detailsChanged && (scope !== "all" || source?.name === targetName) && unchanged) throw new AuthError("VALIDATION_ERROR", "课号和课程名称均未改变", 400);
  }
  const resourceCodes = [...new Set([input.sourceCode, ...affectedPrograms.flatMap(p => p.matches.map(c => c.courseCode))])].filter(code => code !== input.targetCode).sort();
  const [resources, records, teachers, prerequisites, examPrep] = await Promise.all([
    tx.courseResource.findMany({ where: { courseCode: { in: resourceCodes } }, orderBy: { id: "asc" } }),
    tx.courseRecord.findMany({ where: { courseCode: input.sourceCode }, orderBy: { id: "asc" } }),
    tx.teacherCourse.findMany({ where: { courseCode: input.sourceCode }, orderBy: { id: "asc" } }),
    tx.coursePrerequisite.findMany({ where: { OR: [{ courseCode: input.sourceCode }, { prerequisiteCode: input.sourceCode }] }, orderBy: { id: "asc" } }),
    tx.courseExamPrep.findUnique({ where: { courseCode: input.sourceCode } }),
  ]);
  const migrate = codeChanged && !target && input.transfer === "migrate";
  const targetResources = target ? await tx.courseResource.findMany({ where: { courseCode: target.code }, orderBy: { id: "asc" } }) : [];
  const fingerprint = createHash("sha256").update(JSON.stringify({
    input: { ...input, scope, action: undefined, fingerprint: undefined }, source, target, targetResources, references, resources, records, teachers, prerequisites, examPrep,
  })).digest("hex");
  const preview = {
    fingerprint, sourceCode: input.sourceCode, sourceName,
    targetCode: input.targetCode, targetName, details, scope, codeChanged, migrate,
    existingTarget: !!target, existingAction: target ? input.existingAction : undefined,
    resourceCodes, appendResources: [...new Set(resources.map(r => r.resourceId))].filter(id => !targetResources.some(r => r.resourceId === id)).length,
    programs: affectedPrograms.map(p => ({ id: p.id, majorName: p.majorName, year: p.year, matches: p.matches.map(c => ({ code: c.courseCode, name: c.courseName })) })),
    unchangedPrograms: references.length - affectedPrograms.length,
    counts: { resources: resources.length, records: records.length, teachers: teachers.length, prerequisites: prerequisites.length, examPrep: examPrep ? 1 : 0 },
  };
  return { programs: affectedPrograms, preview, records, teachers, prerequisites, examPrep, resources };
}

export async function correctCourse(input: CorrectionInput, userId: string) {
  return prisma.$transaction(async tx => {
    const { programs, preview, records, teachers, prerequisites, examPrep, resources } = await prepare(tx, input);
    if (input.action === "preview") return preview;
    if (preview.fingerprint !== input.fingerprint) throw new AuthError("CONFLICT", "课程或关联数据已变化，请重新预览后确认", 409);
    if (preview.codeChanged && !preview.existingTarget) {
      await tx.course.create({ data: {
        code: input.targetCode, name: preview.targetName,
        ...preview.details,
      } });
    } else if (!preview.existingTarget && preview.scope === "all") {
      await tx.course.upsert({ where: { code: input.sourceCode }, update: { name: preview.targetName, ...preview.details }, create: { code: input.sourceCode, name: preview.targetName, ...preview.details } });
    }
    for (const program of programs) {
      const matchedCodes = new Set(program.matches.map(c => c.courseCode));
      const document = program.programJson ? correctDocumentCourse(program.programJson as unknown as ProgramDocument, input.sourceCode, input.targetCode, preview.targetName, preview.existingTarget ? preview.details.credits : input.details?.credits, preview.sourceName, preview.scope) : null;
      const remaining = listDocumentCourses(document);
      let hasTarget = program.programCourses.some(c => c.courseCode === input.targetCode);
      for (const relation of program.programCourses.filter(c => matchedCodes.has(c.courseCode))) {
        if (relation.courseCode === input.targetCode) {
          // 已有目标课程的关系保留；局部改名使用方案显示名称。
          if (!preview.existingTarget) await tx.programCourse.update({ where: { id: relation.id }, data: { courseNameOverride: preview.scope !== "all" ? preview.targetName : null } });
          continue;
        }
        const keepSource = remaining.some(c => c.courseCode === relation.courseCode);
        if (!hasTarget) {
          if (keepSource) {
            await tx.programCourse.create({ data: { programVersionId: program.id, courseCode: input.targetCode, suggestedSemester: relation.suggestedSemester, isCompulsory: relation.isCompulsory, requirementGroupId: relation.requirementGroupId } });
          } else {
            await tx.programCourse.update({ where: { id: relation.id }, data: { courseCode: input.targetCode, courseNameOverride: null } });
          }
          hasTarget = true;
        } else if (!keepSource) {
          // 同方案已包含 c 时，消除旧关联，避免唯一键冲突；文档中的模块位置仍保留。
          await tx.programCourse.delete({ where: { id: relation.id } });
        }
      }
      if (program.programJson) {
        await tx.programVersion.update({ where: { id: program.id }, data: { programJson: document as unknown as Prisma.InputJsonValue } });
      }
    }
    if (preview.existingAction === "merge_resources" || preview.migrate) {
      // 追加已有资源 ID，不复制文件或审核历史；同一资源只关联目标课程一次。
      if (resources.length) await tx.courseResource.createMany({ data: resources.map(r => ({ courseCode: input.targetCode, resourceId: r.resourceId })), skipDuplicates: true });
      await tx.courseResource.deleteMany({ where: { courseCode: { in: preview.resourceCodes } } });
    }
    if (preview.migrate) {
      const where = { courseCode: input.sourceCode };
      const data = { courseCode: input.targetCode };
      // 保留所有原始 ID、附件、投稿及审核关联，只迁移课程外键。
      await tx.courseRecord.updateMany({ where, data });
      await tx.teacherCourse.updateMany({ where, data });
      await tx.courseExamPrep.updateMany({ where, data });
      await tx.coursePrerequisite.updateMany({ where, data });
      await tx.coursePrerequisite.updateMany({ where: { prerequisiteCode: input.sourceCode }, data: { prerequisiteCode: input.targetCode } });
    } else if (preview.codeChanged && !preview.existingTarget) {
      // 独立课程复制非资源关联，原课程保留原记录；新关联使用新的 ID。
      if (records.length) await tx.courseRecord.createMany({ data: records.map(({ id: _id, ...record }) => ({ ...record, courseCode: input.targetCode })) });
      if (teachers.length) await tx.teacherCourse.createMany({ data: teachers.map(({ id: _id, ...teacher }) => ({ ...teacher, courseCode: input.targetCode })) });
      if (prerequisites.length) await tx.coursePrerequisite.createMany({ data: prerequisites.map(({ id: _id, ...relation }) => ({ ...relation,
        courseCode: relation.courseCode === input.sourceCode ? input.targetCode : relation.courseCode,
        prerequisiteCode: relation.prerequisiteCode === input.sourceCode ? input.targetCode : relation.prerequisiteCode,
      })) });
      if (examPrep) {
        const { id: _id, ...content } = examPrep;
        await tx.courseExamPrep.create({ data: { ...content, courseCode: input.targetCode, chapters: content.chapters as Prisma.InputJsonValue, route: content.route as Prisma.InputJsonValue } });
      }
    }
    await tx.auditLog.create({ data: { userId, action: "COURSE_CORRECTED", targetType: "Course", targetId: input.targetCode, detail: JSON.stringify(preview) } });
    return preview;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}
