import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/auth";
import { correctCourse, type CorrectionInput } from "@/lib/course-correction";
import { correctDocumentCourse, listDocumentCourses } from "@/lib/course-correction-document";
import type { ProgramDocument } from "@/lib/program-document";
import { GET, POST } from "@/app/api/admin/course-corrections/route";
import { GET as getCourses } from "@/app/api/courses/route";
import { createRequest } from "../test-utils";

const prefix = `CORR_${randomUUID().slice(0, 8)}`;
let userId: string;
let token: string;
function document(code: string) {
  const course = { courseCode: code, courseName: "旧名称", credits: 3, semesters: [] };
  return { moduleGroups: [{ name: "必修", courses: [course], children: [{ name: "子模块", courses: [course] }] }], minorPrograms: [{ name: "辅修", courses: [course] }] };
}
async function fixture() {
  const code = `${prefix}_${randomUUID().slice(0, 8)}`;
  await prisma.course.create({ data: { code, name: "旧名称", credits: 3, department: "原院系", category: "major_core", description: "原简介", semester: "大一上" } });
  const programs = await Promise.all([1, 2].map(n => prisma.programVersion.create({ data: {
    majorName: `${code}_${n}`, year: 2026, totalCredits: 120, programJson: document(code),
    programCourses: { create: { courseCode: code, suggestedSemester: 1, isCompulsory: true } },
  } })));
  const input: CorrectionInput = { mode: "program", programId: programs[0]!.id, sourceCode: code, targetCode: `${code}_NEW`, targetName: "修正名称", scope: "selected", transfer: "independent", action: "preview" };
  return { code, programs, input };
}
async function apply(input: CorrectionInput) {
  const preview = await correctCourse(input, userId);
  await correctCourse({ ...input, action: "apply", fingerprint: preview.fingerprint }, userId);
  return preview;
}
beforeAll(async () => {
  const user = await prisma.user.create({ data: { username: prefix, passwordHash: "unused", role: "ADMIN" } });
  userId = user.id;
  token = await signToken({ sub: userId, role: "ADMIN" });
});
afterAll(async () => {
  await prisma.review.deleteMany({ where: { reviewerId: userId } });
  await prisma.submission.deleteMany({ where: { submitterId: userId } });
  await prisma.resource.deleteMany({ where: { submitterId: userId } });
  await prisma.courseRecord.deleteMany({ where: { userId } });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.programVersion.deleteMany({ where: { majorName: { startsWith: prefix } } });
  await prisma.teacher.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.course.deleteMany({ where: { code: { startsWith: prefix } } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("管理员课程修正", () => {
  it.each(["merge_resources", "replace"] as const)("并入已有课号：%s 锁定目标信息并处理同方案重复课程", async existingAction => {
    const { code, programs, input } = await fixture();
    const targetCode = `${code}_EXISTING`;
    const target = await prisma.course.create({ data: { code: targetCode, name: "目标原名称", credits: 6, department: "目标学院" } });
    const targetRelation = await prisma.programCourse.create({ data: { programVersionId: programs[0]!.id, courseCode: targetCode, suggestedSemester: 4, isCompulsory: false } });
    await prisma.courseRecord.create({ data: { userId, courseCode: code, status: "PASSED", source: "MANUAL" } });
    const shared = await prisma.resource.create({ data: { title: "共用", type: "OTHER", submitterId: userId, courseResources: { create: [{ courseCode: code }, { courseCode: targetCode }] } } });
    const sourceResource = await prisma.resource.create({ data: { title: "新增", type: "OTHER", status: "REJECTED", filePath: "keep.pdf", submitterId: userId, courseResources: { create: { courseCode: code } }, submissions: { create: { submitterId: userId, reviews: { create: { reviewerId: userId, result: "REJECTED" } } } } } });
    const inputWithTarget = { ...input, targetCode, targetName: "不得覆盖", details: { credits: 99, department: "不得覆盖", category: "", description: "", semester: "" }, existingAction };
    const preview = await apply(inputWithTarget);
    expect(preview).toMatchObject({ existingTarget: true, targetName: target.name, details: { credits: 6, department: "目标学院" }, appendResources: 1 });
    expect(await prisma.course.findUnique({ where: { code: targetCode } })).toEqual(target);
    expect(await prisma.programCourse.findUnique({ where: { id: targetRelation.id } })).toMatchObject({ suggestedSemester: 4, isCompulsory: false });
    expect(await prisma.programCourse.count({ where: { programVersionId: programs[0]!.id, courseCode: code } })).toBe(0);
    expect(await prisma.programCourse.count({ where: { programVersionId: programs[1]!.id, courseCode: code } })).toBe(1);
    const changed = await prisma.programVersion.findUniqueOrThrow({ where: { id: programs[0]!.id } });
    expect(listDocumentCourses(changed.programJson as unknown as ProgramDocument).every(c => c.courseCode === targetCode && c.courseName === target.name && c.credits === 6)).toBe(true);
    expect(await prisma.courseResource.count({ where: { courseCode: targetCode, resourceId: shared.id } })).toBe(1);
    expect(await prisma.courseResource.count({ where: { courseCode: targetCode } })).toBe(existingAction === "merge_resources" ? 2 : 1);
    expect(await prisma.courseResource.count({ where: { courseCode: code } })).toBe(existingAction === "merge_resources" ? 0 : 2);
    expect(await prisma.resource.findUnique({ where: { id: sourceResource.id } })).toMatchObject({ status: "REJECTED", filePath: "keep.pdf" });
    expect(await prisma.review.count({ where: { submission: { resourceId: sourceResource.id } } })).toBe(1);
    expect(await prisma.courseRecord.count({ where: { courseCode: targetCode } })).toBe(0);
    expect(await prisma.courseRecord.count({ where: { courseCode: code } })).toBe(1);
  });
  it.each(["all", "name", "both"] as const)("全局 %s 按原信息精确匹配，合并所有命中课号的资源", async scope => {
    const { code, programs, input } = await fixture();
    const name = `${code} 原课程名`;
    const otherCode = `${code}_SAME_NAME`;
    const targetCode = `${code}_TARGET`;
    await prisma.course.update({ where: { code }, data: { name } });
    await prisma.course.createMany({ data: [{ code: otherCode, name, credits: 3 }, { code: targetCode, name: "目标", credits: 8 }] });
    const makeDoc = (courseCode: string, courseName: string) => ({ moduleGroups: [{ name: "模块", courses: [{ courseCode, courseName, credits: 3, semesters: [] }] }] });
    await prisma.programVersion.update({ where: { id: programs[0]!.id }, data: { programJson: makeDoc(code, name) } });
    await prisma.programVersion.update({ where: { id: programs[1]!.id }, data: { programJson: makeDoc(code, `${name}（另一名称）`) } });
    const third = await prisma.programVersion.create({ data: { majorName: `${code}_同名`, year: 2026, totalCredits: 120, programJson: makeDoc(otherCode, name), programCourses: { create: { courseCode: otherCode, suggestedSemester: 2, isCompulsory: false } } } });
    for (const courseCode of [code, otherCode]) await prisma.resource.create({ data: { title: courseCode, type: "OTHER", submitterId: userId, courseResources: { create: { courseCode } } } });
    const preview = await apply({ ...input, sourceName: name, targetCode, existingAction: "merge_resources", scope });
    const expectedPrograms = scope === "all" ? [programs[0]!.id, programs[1]!.id] : scope === "name" ? [programs[0]!.id, third.id] : [programs[0]!.id];
    expect(preview.programs.map(p => p.id).sort()).toEqual(expectedPrograms.sort());
    expect(await prisma.courseResource.count({ where: { courseCode: targetCode } })).toBe(scope === "name" ? 2 : 1);
    const p2 = await prisma.programVersion.findUniqueOrThrow({ where: { id: programs[1]!.id } });
    expect(listDocumentCourses(p2.programJson as unknown as ProgramDocument)[0]!.courseCode).toBe(scope === "all" ? targetCode : code);
    expect(await prisma.courseResource.count({ where: { courseCode: otherCode } })).toBe(scope === "name" ? 0 : 1);
  });
  it("同方案同课号不同名称仅替换符合双重条件的节点，保留未匹配关系", async () => {
    const { code, programs, input } = await fixture();
    const targetCode = `${code}_TARGET`;
    await prisma.course.create({ data: { code: targetCode, name: "目标", credits: 5 } });
    await prisma.programVersion.update({ where: { id: programs[0]!.id }, data: { programJson: { moduleGroups: [{ name: "模块", courses: [
      { courseCode: code, courseName: "旧名称", credits: 3, semesters: [] },
      { courseCode: code, courseName: "保留名称", credits: 3, semesters: [] },
    ] }] } } });
    await apply({ ...input, sourceName: "旧名称", scope: "both", targetCode, existingAction: "replace" });
    expect(await prisma.programCourse.count({ where: { programVersionId: programs[0]!.id } })).toBe(2);
    const program = await prisma.programVersion.findUniqueOrThrow({ where: { id: programs[0]!.id } });
    expect(listDocumentCourses(program.programJson as unknown as ProgramDocument).map(c => [c.courseCode, c.courseName])).toEqual([[targetCode, "目标"], [code, "保留名称"]]);
  });
  it("精确课号查询返回目标信息，目标在预览后改变时阻止提交", async () => {
    const { input } = await fixture();
    await prisma.course.create({ data: { code: input.targetCode, name: "已有课程", credits: 4 } });
    const response = await GET(createRequest(`/api/admin/course-corrections?exactCode=${input.targetCode}`, { token }));
    expect((await response.json()).data.course).toMatchObject({ code: input.targetCode, name: "已有课程", credits: 4 });
    const preview = await correctCourse({ ...input, existingAction: "replace" }, userId);
    await prisma.course.update({ where: { code: input.targetCode }, data: { credits: 5 } });
    await expect(correctCourse({ ...input, existingAction: "replace", action: "apply", fingerprint: preview.fingerprint }, userId)).rejects.toThrow("已变化");
  });
  it("独立课程复制所有非资源关联并将编辑后的信息同步到课程库", async () => {
    const { code, input, programs } = await fixture();
    const other = `${code}_OTHER`;
    await prisma.course.create({ data: { code: other, name: "先修", credits: 1 } });
    const record = await prisma.courseRecord.create({ data: { courseCode: code, userId, source: "IMPORT", status: "PASSED", semester: 2 } });
    const teacher = await prisma.teacher.create({ data: { name: `${prefix}_独立教师`, courses: { create: { courseCode: code, gpa: 4 } } } });
    await prisma.coursePrerequisite.createMany({ data: [{ courseCode: code, prerequisiteCode: other }, { courseCode: other, prerequisiteCode: code }] });
    await prisma.courseExamPrep.create({ data: { courseCode: code, chapters: [{ chapter: "章节" }], route: ["路线"], updatedById: userId } });
    await prisma.resource.create({ data: { title: "不复制", type: "OTHER", submitterId: userId, filePath: "original.pdf", courseResources: { create: { courseCode: code } } } });
    const details = { credits: 4.5, department: "数学学院", category: "major_base", description: "修正简介", semester: "大二上" };
    await apply({ ...input, details });
    expect(await prisma.courseRecord.findUnique({ where: { id: record.id } })).toMatchObject({ courseCode: code });
    const copy = await prisma.courseRecord.findFirstOrThrow({ where: { courseCode: input.targetCode } });
    expect(copy).toMatchObject({ status: "PASSED", source: "IMPORT", semester: 2, userId });
    expect(copy.id).not.toBe(record.id);
    expect(await prisma.teacherCourse.count({ where: { teacherId: teacher.id } })).toBe(2);
    expect(await prisma.coursePrerequisite.count({ where: { OR: [{ courseCode: code }, { prerequisiteCode: code }] } })).toBe(2);
    expect(await prisma.coursePrerequisite.count({ where: { OR: [{ courseCode: input.targetCode }, { prerequisiteCode: input.targetCode }] } })).toBe(2);
    expect(await prisma.courseExamPrep.findUnique({ where: { courseCode: input.targetCode } })).toMatchObject({ chapters: [{ chapter: "章节" }], route: ["路线"] });
    expect(await prisma.courseExamPrep.count({ where: { courseCode: code } })).toBe(1);
    expect(await prisma.courseResource.count({ where: { courseCode: input.targetCode } })).toBe(0);
    expect(await prisma.courseResource.count({ where: { courseCode: code } })).toBe(1);
    expect(await prisma.course.findUnique({ where: { code: input.targetCode } })).toMatchObject(details);
    const response = await getCourses(createRequest(`/api/courses?search=${input.targetCode}`));
    expect((await response.json()).data[0]).toMatchObject({ code: input.targetCode, name: input.targetName, credits: 4.5, department: "数学学院" });
    const document = await prisma.programVersion.findUniqueOrThrow({ where: { id: programs[0]!.id } });
    expect(listDocumentCourses(document.programJson as unknown as ProgramDocument).every(c => c.credits === 4.5)).toBe(true);
  });
  it("原课号可单独修改学院等公共信息，并同步课程库及培养方案", async () => {
    const { code, input } = await fixture();
    const details = { credits: 5, department: "新学院", category: "major_core", description: "新简介", semester: "大三上" };
    const update = { ...input, targetCode: code, targetName: "旧名称", details };
    await expect(correctCourse(update, userId)).rejects.toThrow("公共信息");
    await apply({ ...update, scope: "all" });
    expect(await prisma.course.findUnique({ where: { code } })).toMatchObject(details);
    const response = await getCourses(createRequest(`/api/courses?search=${code}`));
    expect((await response.json()).data[0]).toMatchObject({ credits: 5, department: "新学院" });
  });
  it("拒绝匿名和非管理员读取及写入", async () => {
    const visitor = await signToken({ sub: userId, role: "VISITOR" });
    for (const handler of [GET, POST]) {
      expect((await handler(createRequest("/api/admin/course-corrections", { method: handler === POST ? "POST" : "GET" }))).status).toBe(401);
      expect((await handler(createRequest("/api/admin/course-corrections", { method: handler === POST ? "POST" : "GET", token: visitor }))).status).toBe(403);
    }
  });
  it("默认只改变所选方案，独立课程不带资源", async () => {
    const { code, programs, input } = await fixture();
    const resource = await prisma.resource.create({ data: { title: "资料", type: "OTHER", submitterId: userId, courseResources: { create: { courseCode: code } } } });
    const preview = await apply(input);
    expect(preview.programs.map(p => p.id)).toEqual([programs[0]!.id]);
    expect(await prisma.courseResource.findFirst({ where: { resourceId: resource.id } })).toMatchObject({ courseCode: code });
    expect(await prisma.course.findUnique({ where: { code: input.targetCode } })).toMatchObject({
      credits: 3, department: "原院系", category: "major_core", description: "原简介", semester: "大一上",
    });
    expect(await prisma.course.findUnique({ where: { code } })).toMatchObject({ credits: 3, department: "原院系", description: "原简介" });
    for (const [i, p] of programs.entries()) {
      const updated = await prisma.programVersion.findUniqueOrThrow({ where: { id: p.id }, include: { programCourses: true } });
      const expected = i === 0 ? input.targetCode : code;
      expect(updated.programCourses[0]!.courseCode).toBe(expected);
      expect(updated.programCourses[0]!).toMatchObject({ suggestedSemester: 1, isCompulsory: true });
      expect(listDocumentCourses(updated.programJson as unknown as ProgramDocument).map(c => c.courseCode)).toEqual([expected, expected, expected]);
      expect(listDocumentCourses(updated.programJson as unknown as ProgramDocument).map(c => c.credits)).toEqual([3, 3, 3]);
    }
  });
  it("同课号局部名称不改变课程主表，全部改名清除局部覆盖", async () => {
    const { code, programs, input } = await fixture();
    input.targetCode = code;
    await apply(input);
    expect(await prisma.course.findUnique({ where: { code } })).toMatchObject({ name: "旧名称" });
    expect(await prisma.programCourse.findFirst({ where: { programVersionId: programs[0]!.id } })).toMatchObject({ courseNameOverride: "修正名称" });
    expect(await prisma.programCourse.findFirst({ where: { programVersionId: programs[1]!.id } })).toMatchObject({ courseNameOverride: null });
    await apply({ ...input, scope: "all", targetName: "统一名称" });
    expect(await prisma.course.findUnique({ where: { code } })).toMatchObject({ name: "统一名称" });
    expect(await prisma.programCourse.count({ where: { courseCode: code, courseNameOverride: { not: null } } })).toBe(0);
  });
  it("完整迁移保留附件、所有审核状态、修课记录、教师与双向先修关系", async () => {
    const { code, input } = await fixture();
    const relatedCode = `${code}_RELATED`;
    await prisma.course.create({ data: { code: relatedCode, name: "其他课程", credits: 2 } });
    const resourceIds: string[] = [];
    for (const status of ["DRAFT", "PENDING", "APPROVED", "REJECTED"] as const) {
      const r = await prisma.resource.create({ data: { title: status, type: "OTHER", status, filePath: "preserved.pdf", fileName: "资料.pdf", submitterId: userId, courseResources: { create: [{ courseCode: code }, { courseCode: relatedCode }] }, submissions: { create: { submitterId: userId, reviews: { create: { reviewerId: userId, result: "APPROVED" } } } } } });
      resourceIds.push(r.id);
    }
    const record = await prisma.courseRecord.create({ data: { userId, courseCode: code, status: "PASSED", source: "MANUAL", semester: 3 } });
    const teacher = await prisma.teacher.create({ data: { name: `${prefix}_教师`, courses: { create: { courseCode: code, gpa: 4.2 } }, reviews: { create: { content: "评价", likes: 3 } } } });
    await prisma.coursePrerequisite.createMany({ data: [{ courseCode: code, prerequisiteCode: relatedCode }, { courseCode: relatedCode, prerequisiteCode: code }] });
    await prisma.courseExamPrep.create({ data: { courseCode: code, chapters: [{ chapter: "第一章" }], route: ["复习"], updatedById: userId } });
    const preview = await apply({ ...input, transfer: "migrate" });
    expect(preview.counts).toEqual({ resources: 4, records: 1, teachers: 1, prerequisites: 2, examPrep: 1 });
    expect(await prisma.course.findUnique({ where: { code: input.targetCode } })).toMatchObject({ credits: 3, department: "原院系", description: "原简介", semester: "大一上" });
    expect(await prisma.courseResource.count({ where: { courseCode: code } })).toBe(0);
    expect(await prisma.courseResource.count({ where: { courseCode: input.targetCode } })).toBe(4);
    expect(await prisma.courseResource.count({ where: { courseCode: relatedCode } })).toBe(4);
    expect(await prisma.resource.count({ where: { id: { in: resourceIds }, filePath: "preserved.pdf" } })).toBe(4);
    expect(await prisma.review.count({ where: { submission: { resourceId: { in: resourceIds } } } })).toBe(4);
    expect(await prisma.courseRecord.findUnique({ where: { id: record.id } })).toMatchObject({ courseCode: input.targetCode, status: "PASSED", semester: 3 });
    expect(await prisma.teacherCourse.findFirst({ where: { teacherId: teacher.id } })).toMatchObject({ courseCode: input.targetCode, gpa: 4.2 });
    expect(await prisma.teacherReview.count({ where: { teacherId: teacher.id } })).toBe(1);
    expect(await prisma.coursePrerequisite.count({ where: { OR: [{ courseCode: input.targetCode }, { prerequisiteCode: input.targetCode }] } })).toBe(2);
    expect(await prisma.courseExamPrep.findUnique({ where: { courseCode: input.targetCode } })).toMatchObject({ route: ["复习"] });
  });
  it("搜索模式在服务端强制应用全部方案", async () => {
    const { input } = await fixture();
    const response = await POST(createRequest("/api/admin/course-corrections", { method: "POST", token, body: { ...input, mode: "search", scope: "selected" } }));
    const { data } = await response.json();
    expect(response.status).toBe(200);
    expect(data.scope).toBe("all");
    expect(data.programs).toHaveLength(2);
    await apply({ ...input, mode: "search" });
    expect(await prisma.programCourse.count({ where: { courseCode: input.targetCode } })).toBe(2);
  });
  it("目标课号冲突、过期预览和写入失败不会留下部分修改", async () => {
    const { code, input } = await fixture();
    await expect(correctCourse({ ...input, targetCode: code, targetName: "旧名称" }, userId)).rejects.toThrow("均未改变");
    const preview = await correctCourse(input, userId);
    await prisma.course.update({ where: { code }, data: { name: "已被修改" } });
    await expect(correctCourse({ ...input, action: "apply", fingerprint: preview.fingerprint }, userId)).rejects.toThrow("已变化");
    const fresh = await correctCourse(input, userId);
    // 审计用户外键失败发生在事务末尾，应回滚新课程和方案修改。
    await expect(correctCourse({ ...input, action: "apply", fingerprint: fresh.fingerprint }, randomUUID())).rejects.toThrow();
    expect(await prisma.course.findUnique({ where: { code: input.targetCode } })).toBeNull();
    expect(await prisma.programCourse.count({ where: { courseCode: code } })).toBe(2);
    await prisma.course.create({ data: { code: input.targetCode, name: "已有课程", credits: 1 } });
    await expect(correctCourse(input, userId)).rejects.toThrow("目标课号已存在");
  });
  it("可修正仅存在于文档中的课程，不改动同名课程或说明文字", async () => {
    const { code, programs, input } = await fixture();
    await prisma.programCourse.deleteMany({ where: { courseCode: code } });
    await prisma.course.delete({ where: { code } });
    await apply(input);
    expect(await prisma.course.findUnique({ where: { code: input.targetCode } })).toMatchObject({ credits: 3 });
    const source = { ...document(code), note: code } as unknown as ProgramDocument;
    source.moduleGroups[0]!.courses!.push({ courseCode: "UNCHANGED", courseName: "旧名称", credits: 3, semesters: [] });
    const corrected = correctDocumentCourse(source, code, input.targetCode, input.targetName);
    expect(listDocumentCourses(corrected).some(c => c.courseCode === "UNCHANGED" && c.courseName === "旧名称")).toBe(true);
    expect((corrected as unknown as { note: string }).note).toBe(code);
    const response = await GET(createRequest(`/api/admin/course-corrections?programId=${programs[0]!.id}`, { token }));
    expect(response.status).toBe(200);
    expect((await response.json()).data.courses[0].courseCode).toBe(input.targetCode);
  });
});
