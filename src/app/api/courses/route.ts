import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/courses?major=&semester=&page=&pageSize=
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const major = searchParams.get("major");
    const programVersionIds = searchParams.getAll("programVersionId").filter(Boolean);
    const semester = searchParams.get("semester");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(
      500,
      Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)),
    );

    // Build the where clause
    const where: Record<string, unknown> = {};

    if (semester) {
      where.semester = semester;
    }

    if (programVersionIds.length > 0) {
      where.programCourses = {
        some: {
          programVersionId: { in: programVersionIds },
        },
      };
    } else if (major) {
      // Filter courses that belong to the given major via ProgramCourse -> ProgramVersion
      where.programCourses = {
        some: {
          programVersion: {
            majorName: major,
          },
        },
      };
    }

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        select: {
          code: true,
          name: true,
          credits: true,
          department: true,
          category: true,
          semester: true,
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { code: "asc" },
      }),
      prisma.course.count({ where }),
    ]);

    return NextResponse.json({
      data: courses,
      pagination: {
        page,
        pageSize,
        total,
      },
    });
  } catch (error) {
    console.error("GET /api/courses error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500 },
    );
  }
}
