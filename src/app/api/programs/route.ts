import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/programs — 列出所有可选的培养方案（学生选年级+专业用）
export async function GET() {
  try {
    const programs = await prisma.programVersion.findMany({
      where: { isActive: true },
      select: { id: true, majorName: true, year: true, totalCredits: true },
      orderBy: [{ year: "desc" }, { majorName: "asc" }],
    });

    const byYear = new Map<number, string[]>();
    for (const p of programs) {
      const list = byYear.get(p.year) ?? [];
      list.push(p.majorName);
      byYear.set(p.year, list);
    }

    const years = Array.from(byYear.entries())
      .sort(([a], [b]) => b - a)
      .map(([year, majors]) => ({ year, majors: majors.sort() }));

    return NextResponse.json({ data: { years, options: programs, total: programs.length } });
  } catch {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } }, { status: 500 });
  }
}
