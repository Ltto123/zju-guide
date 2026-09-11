// =============================================================================
// path-engine.ts — 四类路径计算引擎
//
// 输入: userId + currentSemester
// 查询: 用户的 course_records (已修课程)、program_courses (培养方案要求)
// 输出: 四类结果，每项附带 reasonCode
// =============================================================================

import { prisma } from "@/lib/prisma";
import type {
  Prisma,
  CourseRecord,
  ProgramCourse,
  RequirementGroup,
  Course,
  ProgramVersion,
} from "@prisma/client";

// -----------------------------------------------------------------------------
// Shared type helpers — lean snapshots detached from Prisma, safe for tests
// -----------------------------------------------------------------------------

export interface CourseRecordSnapshot {
  courseCode: string;
  status: "PASSED" | "ENROLLED" | "PLANNED";
  semester: number | null;
}

export interface ProgramCourseSnapshot {
  courseCode: string;
  suggestedSemester: number;
  isCompulsory: boolean;
  requirementGroupId: string | null;
  /** Populated from the join – the master Course row */
  course: { code: string; name: string; credits: number; department: string | null; category: string | null };
  /** Populated from the join – the parent requirement group (may be null) */
  requirementGroup: { id: string; name: string; category: string; requiredCredits: number } | null;
}

export interface RequirementGroupSnapshot {
  id: string;
  name: string;
  category: string;
  requiredCredits: number;
  programCourses: ProgramCourseSnapshot[];
}

export interface ProgramVersionSnapshot {
  id: string;
  majorName: string;
  year: number;
}

// -----------------------------------------------------------------------------
// Output types
// -----------------------------------------------------------------------------

/** 本学期必修 (type 1) — single course entry */
export interface RequiredCourseEntry {
  courseCode: string;
  courseName: string;
  credits: number;
  suggestedSemester: number;
}

/** 本学期必修 (type 1) — full result */
export interface RequiredResult {
  courses: RequiredCourseEntry[];
  programVersion: ProgramVersionSnapshot | null;
  ruleSource: string;
  reasonCode: string;
}

/** 通识要求 (type 2) — single group progress bar */
export interface GenEdGroupProgress {
  groupId: string;
  groupName: string;
  requiredCredits: number;
  earnedCredits: number;
  remainingCredits: number;
  passedCourseCodes: string[];
}

/** 通识要求 (type 2) — full result */
export interface GenEdResult {
  groups: GenEdGroupProgress[];
  programVersion: ProgramVersionSnapshot | null;
  ruleSource: string;
  reasonCode: string;
}

/** 逾期未修 (type 3) — single overdue entry */
export interface OverdueCourseEntry {
  courseCode: string;
  courseName: string;
  credits: number;
  suggestedSemester: number;
}

/** 逾期未修 (type 3) — full result */
export interface OverdueResult {
  courses: OverdueCourseEntry[];
  programVersion: ProgramVersionSnapshot | null;
  ruleSource: string;
  reasonCode: string;
}

/** 辅修要求 (type 4) — single group progress */
export interface MinorGroupProgress {
  groupId: string;
  groupName: string;
  requiredCredits: number;
  earnedCredits: number;
  remainingCredits: number;
  passedCourseCodes: string[];
}

/** 辅修要求 (type 4) — full result */
export interface MinorResult {
  groups: MinorGroupProgress[];
  programVersion: ProgramVersionSnapshot | null;
  ruleSource: string;
  reasonCode: string;
}

// -----------------------------------------------------------------------------
// Pure calculation functions (no Prisma dependency — testable with snapshots)
// -----------------------------------------------------------------------------

/**
 * 类型1 — 本学期必修 (required)
 *
 * 查询当前学期（suggestedSemester = currentSemester）的必修课（isCompulsory = true），
 * 排除已通过的。返回课程列表。
 */
export function computeRequired(
  programCourses: ProgramCourseSnapshot[],
  courseRecords: CourseRecordSnapshot[],
  currentSemester: number,
  programVersion: ProgramVersionSnapshot | null,
): RequiredResult {
  const passedCodes = new Set(
    courseRecords.filter((r) => r.status === "PASSED").map((r) => r.courseCode),
  );

  const requiredCourses = programCourses
    .filter(
      (pc) =>
        pc.suggestedSemester === currentSemester &&
        pc.isCompulsory &&
        !passedCodes.has(pc.courseCode),
    )
    .map((pc) => ({
      courseCode: pc.courseCode,
      courseName: pc.course.name,
      credits: pc.course.credits,
      suggestedSemester: pc.suggestedSemester,
    }));

  return {
    courses: requiredCourses,
    programVersion,
    ruleSource: "program_version.required_current_semester",
    reasonCode: "REQUIRED_CURRENT_SEMESTER",
  };
}

/**
 * 类型2 — 通识要求 (genEd)
 *
 * 按 requirement_groups 分组统计已修 vs 尚缺学分，返回进度条数据。
 * 仅统计 category === "gen_ed" 的 requirement group。
 */
export function computeGenEd(
  requirementGroups: RequirementGroupSnapshot[],
  courseRecords: CourseRecordSnapshot[],
  programVersion: ProgramVersionSnapshot | null,
): GenEdResult {
  const passedCodes = new Set(
    courseRecords.filter((r) => r.status === "PASSED").map((r) => r.courseCode),
  );

  const genEdGroups = requirementGroups.filter((g) => g.category === "gen_ed");

  const groups: GenEdGroupProgress[] = genEdGroups.map((group) => {
    const passedCourseCodes: string[] = [];
    let earnedCredits = 0;

    for (const pc of group.programCourses) {
      if (passedCodes.has(pc.courseCode)) {
        passedCourseCodes.push(pc.courseCode);
        earnedCredits += pc.course.credits;
      }
    }

    return {
      groupId: group.id,
      groupName: group.name,
      requiredCredits: group.requiredCredits,
      earnedCredits: Math.min(earnedCredits, group.requiredCredits),
      remainingCredits: Math.max(0, group.requiredCredits - earnedCredits),
      passedCourseCodes,
    };
  });

  return {
    groups,
    programVersion,
    ruleSource: "program_version.gen_ed_requirement",
    reasonCode: "GEN_ED_PROGRESS",
  };
}

/**
 * 类型3 — 逾期未修 (overdue)
 *
 * 查询 suggestedSemester < currentSemester 且 isCompulsory = true 且未通过的课程。
 * 标记为警告。
 */
export function computeOverdue(
  programCourses: ProgramCourseSnapshot[],
  courseRecords: CourseRecordSnapshot[],
  currentSemester: number,
  programVersion: ProgramVersionSnapshot | null,
): OverdueResult {
  const passedCodes = new Set(
    courseRecords.filter((r) => r.status === "PASSED").map((r) => r.courseCode),
  );

  const overdueCourses = programCourses
    .filter(
      (pc) =>
        pc.suggestedSemester < currentSemester &&
        pc.isCompulsory &&
        !passedCodes.has(pc.courseCode),
    )
    .map((pc) => ({
      courseCode: pc.courseCode,
      courseName: pc.course.name,
      credits: pc.course.credits,
      suggestedSemester: pc.suggestedSemester,
    }))
    // Sort by suggestedSemester ascending — earliest overdue first
    .sort((a, b) => a.suggestedSemester - b.suggestedSemester);

  return {
    courses: overdueCourses,
    programVersion,
    ruleSource: "program_version.overdue_compulsory",
    reasonCode: "OVERDUE_COMPULSORY",
  };
}

/**
 * 类型4 — 辅修要求 (minor)
 *
 * 如果用户有辅修（minor 类型的 user_programs），独立计算完成度。
 * MVP 阶段如果没有辅修数据，返回空 groups。
 */
export function computeMinor(
  requirementGroups: RequirementGroupSnapshot[],
  courseRecords: CourseRecordSnapshot[],
  programVersion: ProgramVersionSnapshot | null,
): MinorResult {
  if (!programVersion) {
    return {
      groups: [],
      programVersion: null,
      ruleSource: "program_version.minor_requirement",
      reasonCode: "MINOR_PROGRESS",
    };
  }

  const passedCodes = new Set(
    courseRecords.filter((r) => r.status === "PASSED").map((r) => r.courseCode),
  );

  const groups: MinorGroupProgress[] = requirementGroups.map((group) => {
    const passedCourseCodes: string[] = [];
    let earnedCredits = 0;

    for (const pc of group.programCourses) {
      if (passedCodes.has(pc.courseCode)) {
        passedCourseCodes.push(pc.courseCode);
        earnedCredits += pc.course.credits;
      }
    }

    return {
      groupId: group.id,
      groupName: group.name,
      requiredCredits: group.requiredCredits,
      earnedCredits: Math.min(earnedCredits, group.requiredCredits),
      remainingCredits: Math.max(0, group.requiredCredits - earnedCredits),
      passedCourseCodes,
    };
  });

  return {
    groups,
    programVersion,
    ruleSource: "program_version.minor_requirement",
    reasonCode: "MINOR_PROGRESS",
  };
}

// -----------------------------------------------------------------------------
// Internal helpers — reshape Prisma query results into snapshots
// -----------------------------------------------------------------------------

function toCourseRecordSnapshots(records: CourseRecord[]): CourseRecordSnapshot[] {
  return records.map((r) => ({
    courseCode: r.courseCode,
    status: r.status as CourseRecordSnapshot["status"],
    semester: r.semester,
  }));
}

function toProgramCourseSnapshots(
  pcs: (ProgramCourse & {
    course: Course;
    requirementGroup: (RequirementGroup & { programCourses: (ProgramCourse & { course: Course })[] }) | null;
  })[],
): ProgramCourseSnapshot[] {
  return pcs.map((pc) => ({
    courseCode: pc.courseCode,
    suggestedSemester: pc.suggestedSemester,
    isCompulsory: pc.isCompulsory,
    requirementGroupId: pc.requirementGroupId,
    course: {
      code: pc.course.code,
      name: pc.courseNameOverride ?? pc.course.name,
      credits: pc.course.credits,
      department: pc.course.department,
      category: pc.course.category,
    },
    requirementGroup: pc.requirementGroup
      ? {
          id: pc.requirementGroup.id,
          name: pc.requirementGroup.name,
          category: pc.requirementGroup.category,
          requiredCredits: pc.requirementGroup.requiredCredits,
        }
      : null,
  }));
}

function toRequirementGroupSnapshots(
  groups: (RequirementGroup & {
    programCourses: (ProgramCourse & { course: Course })[];
  })[],
): RequirementGroupSnapshot[] {
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    category: g.category,
    requiredCredits: g.requiredCredits,
    programCourses: g.programCourses.map((pc) => ({
      courseCode: pc.courseCode,
      suggestedSemester: pc.suggestedSemester,
      isCompulsory: pc.isCompulsory,
      requirementGroupId: pc.requirementGroupId,
      course: {
        code: pc.course.code,
        name: pc.courseNameOverride ?? pc.course.name,
        credits: pc.course.credits,
        department: pc.course.department,
        category: pc.course.category,
      },
      requirementGroup: {
        id: g.id,
        name: g.name,
        category: g.category,
        requiredCredits: g.requiredCredits,
      },
    })),
  }));
}

function toProgramVersionSnapshot(pv: ProgramVersion | null): ProgramVersionSnapshot | null {
  if (!pv) return null;
  return {
    id: pv.id,
    majorName: pv.majorName,
    year: pv.year,
  };
}

// -----------------------------------------------------------------------------
// The Prisma include fragment reused in every query
// -----------------------------------------------------------------------------

const programCourseInclude = {
  course: true,
  requirementGroup: {
    include: {
      programCourses: {
        include: { course: true },
      },
    },
  },
} as const satisfies Prisma.ProgramCourseInclude;

const requirementGroupInclude = {
  programCourses: {
    include: { course: true },
  },
} as const satisfies Prisma.RequirementGroupInclude;

// -----------------------------------------------------------------------------
// Orchestration — loads all data from DB, delegates to pure functions
// -----------------------------------------------------------------------------

export interface PathEngineContext {
  userId: string;
  currentSemester: number;
  /** Optionally restrict to a specific program version (e.g. "major" or "minor"). */
  programType?: "MAJOR" | "MINOR";
}

/**
 * Fetch the active UserProgram + ProgramVersion for the given user.
 * Returns null when the user has no matching program.
 */
async function resolveProgramVersion(
  userId: string,
  programType: "MAJOR" | "MINOR" = "MAJOR",
) {
  const userProgram = await prisma.userProgram.findFirst({
    where: { userId, type: programType, programVersion: { isActive: true } },
    include: { programVersion: true },
    orderBy: { createdAt: "desc" },
  });
  return userProgram ?? null;
}

/**
 * Load all data needed for the path engine and return four computed results.
 */
export async function calculateAllPaths(context: PathEngineContext): Promise<{
  required: RequiredResult;
  genEd: GenEdResult;
  overdue: OverdueResult;
  minor: MinorResult;
}> {
  const { userId, currentSemester } = context;

  // ---- resolve major program version ----
  const majorUP = await resolveProgramVersion(userId, "MAJOR");
  const majorPV = majorUP?.programVersion ?? null;
  const majorPVId = majorPV?.id;

  // ---- load course records (all statuses) ----
  const records = await prisma.courseRecord.findMany({
    where: { userId },
  });
  const recordSnapshots = toCourseRecordSnapshots(records);

  // ---- load program courses for major ----
  let majorProgramCourses: ProgramCourseSnapshot[] = [];
  let majorRequirementGroups: RequirementGroupSnapshot[] = [];
  if (majorPVId) {
    const pcs = await prisma.programCourse.findMany({
      where: { programVersionId: majorPVId },
      include: programCourseInclude,
    });
    majorProgramCourses = toProgramCourseSnapshots(pcs);

    const groups = await prisma.requirementGroup.findMany({
      where: { programVersionId: majorPVId },
      include: requirementGroupInclude,
    });
    majorRequirementGroups = toRequirementGroupSnapshots(groups);
  }

  const pvSnapshot = toProgramVersionSnapshot(majorPV);

  // ---- compute types 1-3 against major ----
  const required = computeRequired(majorProgramCourses, recordSnapshots, currentSemester, pvSnapshot);
  const genEd = computeGenEd(majorRequirementGroups, recordSnapshots, pvSnapshot);
  const overdue = computeOverdue(majorProgramCourses, recordSnapshots, currentSemester, pvSnapshot);

  // ---- resolve minor (type 4) ----
  const minorUP = await resolveProgramVersion(userId, "MINOR");
  const minorPV = minorUP?.programVersion ?? null;
  const minorPVSnapshot = toProgramVersionSnapshot(minorPV);

  let minorResult: MinorResult;
  if (!minorUP || !minorPV) {
    minorResult = {
      groups: [],
      programVersion: null,
      ruleSource: "program_version.minor_requirement",
      reasonCode: "MINOR_PROGRESS",
    };
  } else {
    const minorGroups = await prisma.requirementGroup.findMany({
      where: { programVersionId: minorPV.id },
      include: requirementGroupInclude,
    });
    const minorGroupSnapshots = toRequirementGroupSnapshots(minorGroups);
    minorResult = computeMinor(minorGroupSnapshots, recordSnapshots, minorPVSnapshot);
  }

  return { required, genEd, overdue, minor: minorResult };
}
