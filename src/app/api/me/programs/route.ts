import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, AuthError } from "@/lib/auth";
import { z } from "zod";

const SelectProgramSchema = z.object({
  majorName: z.string().min(1),
  year: z.number().int().min(2018).max(2030),
  type: z.enum(["MAJOR", "MINOR"]).default("MAJOR"),
});

const ReplaceProgramsSchema = z.object({
  majorProgramVersionId: z.string().uuid(),
  minorProgramVersionIds: z.array(z.string().uuid()).max(3).default([]),
}).superRefine((value, ctx) => {
  const ids = [value.majorProgramVersionId, ...value.minorProgramVersionIds];
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "主修和辅修专业不能重复",
      path: ["minorProgramVersionIds"],
    });
  }
});

function handleError(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  if (e instanceof z.ZodError) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "输入格式错误", details: e.errors } }, { status: 400 });
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } }, { status: 500 });
}

// GET — 查看当前用户的培养方案
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);
    const programs = await prisma.userProgram.findMany({
      where: { userId }, include: { programVersion: true }, orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ data: programs });
  } catch (e) { return handleError(e); }
}

// POST — 学生选择/切换培养方案
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);
    const body = await request.json();
    const parsed = SelectProgramSchema.parse(body);

    const program = await prisma.programVersion.findUnique({
      where: { majorName_year: { majorName: parsed.majorName, year: parsed.year } },
    });

    if (!program) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: `未找到 ${parsed.year}级 ${parsed.majorName} 的培养方案` } }, { status: 404 });
    }

    const userProgram = await prisma.userProgram.upsert({
      where: { userId_programVersionId_type: { userId, programVersionId: program.id, type: parsed.type } },
      create: { userId, programVersionId: program.id, type: parsed.type, isConfirmed: true },
      update: { isConfirmed: true },
    });

    return NextResponse.json({ data: userProgram }, { status: 201 });
  } catch (e) { return handleError(e); }
}

// PUT — 一次替换一个主修和至多三个辅修培养方案
export async function PUT(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);
    const parsed = ReplaceProgramsSchema.parse(await request.json());
    const requestedIds = [
      parsed.majorProgramVersionId,
      ...parsed.minorProgramVersionIds,
    ];

    const availablePrograms = await prisma.programVersion.findMany({
      where: { id: { in: requestedIds }, isActive: true },
      select: { id: true },
    });

    if (availablePrograms.length !== requestedIds.length) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "部分培养方案不存在或已停用" } },
        { status: 404 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.userProgram.deleteMany({ where: { userId } });
      await tx.userProgram.createMany({
        data: [
          {
            userId,
            programVersionId: parsed.majorProgramVersionId,
            type: "MAJOR",
            isConfirmed: true,
          },
          ...parsed.minorProgramVersionIds.map((programVersionId) => ({
            userId,
            programVersionId,
            type: "MINOR" as const,
            isConfirmed: true,
          })),
        ],
      });
    });

    const programs = await prisma.userProgram.findMany({
      where: { userId },
      include: { programVersion: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ data: programs });
  } catch (e) { return handleError(e); }
}
