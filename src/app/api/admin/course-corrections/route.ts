import { NextResponse, type NextRequest } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listDocumentCourses } from "@/lib/course-correction-document";
import type { ProgramDocument } from "@/lib/program-document";
import { Prisma } from "@prisma/client";
import { correctionSchema, correctCourse } from "@/lib/course-correction";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireRole(request, "ADMIN");
    const parsed = correctionSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "参数无效", 400);
    return NextResponse.json({ data: await correctCourse(parsed.data, userId) });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "请求格式无效" } }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) return NextResponse.json({ error: { code: "CONFLICT", message: "数据已发生变化，请重新预览后重试" } }, { status: 409 });
    console.error("POST /api/admin/course-corrections error:", error);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "课程修正失败，未保存任何修改" } }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, "ADMIN");
    const exactCode = request.nextUrl.searchParams.get("exactCode");
    if (exactCode !== null) {
      if (!exactCode.trim() || exactCode.length > 100) throw new AuthError("VALIDATION_ERROR", "课号无效", 400);
      const course = await prisma.course.findUnique({ where: { code: exactCode.trim() } });
      return NextResponse.json({ data: { course } });
    }
    const programId = request.nextUrl.searchParams.get("programId");
    if (programId) {
      const program = await prisma.programVersion.findUnique({
        where: { id: programId },
        include: { programCourses: { include: { course: true, requirementGroup: true }, orderBy: { suggestedSemester: "asc" } } },
      });
      if (!program) throw new AuthError("NOT_FOUND", "培养方案不存在", 404);
      const courses = listDocumentCourses(program.programJson as unknown as ProgramDocument | null);
      const metadata = await prisma.course.findMany({ where: { code: { in: courses.map(c => c.courseCode) } } });
      const included = new Set(courses.map(course => course.courseCode));
      for (const relation of program.programCourses) {
        if (included.has(relation.courseCode)) continue;
        courses.push({
          courseCode: relation.courseCode, courseName: relation.courseNameOverride ?? relation.course.name, credits: relation.course.credits,
          path: [relation.requirementGroup?.name ?? "其他课程"], semesters: [],
        });
      }
      return NextResponse.json({ data: { id: program.id, majorName: program.majorName, year: program.year, totalCredits: program.totalCredits, courses: courses.map(c => {
        const course = metadata.find(m => m.code === c.courseCode) ?? program.programCourses.find(p => p.courseCode === c.courseCode)?.course;
        return { ...c, details: { credits: course?.credits ?? c.credits, department: course?.department ?? "", category: course?.category ?? "", description: course?.description ?? "", semester: course?.semester ?? "" } };
      }) } });
    }
    const search = request.nextUrl.searchParams.get("search");
    if (search !== null) {
      const query = search.trim();
      if (!query || query.length > 100) throw new AuthError("VALIDATION_ERROR", "请输入不超过 100 个字符的课程名或课号", 400);
      const page = Number(request.nextUrl.searchParams.get("page") ?? 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new AuthError("VALIDATION_ERROR", "页码无效", 400);
      const where = { OR: [{ code: { contains: query, mode: "insensitive" as const } }, { name: { contains: query, mode: "insensitive" as const } }] };
      const [courses, total] = await Promise.all([
        prisma.course.findMany({ where, orderBy: { code: "asc" }, skip: (page - 1) * 20, take: 20 }),
        prisma.course.count({ where }),
      ]);
      return NextResponse.json({ data: { courses, total, page, pageSize: 20 } });
    }
    const programs = await prisma.programVersion.findMany({ select: { id: true, majorName: true, year: true, isActive: true }, orderBy: [{ year: "desc" }, { majorName: "asc" }] });
    return NextResponse.json({ data: programs });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    console.error("GET /api/admin/course-corrections error:", error);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "课程信息加载失败" } }, { status: 500 });
  }
}
