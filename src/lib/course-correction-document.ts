import type { ModuleCourse, ModuleGroup, ProgramDocument } from "@/lib/program-document";

export interface CourseOccurrence {
  courseCode: string;
  courseName: string;
  credits: number;
  path: string[];
  semesters: ModuleCourse["semesters"];
}

/** 只读取课程节点，不把规则说明或名称相近的课程误当作同一门课。 */
export function listDocumentCourses(document: ProgramDocument | null): CourseOccurrence[] {
  if (!document) return [];
  const result: CourseOccurrence[] = [];
  function visit(groups: ModuleGroup[], parents: string[]) {
    for (const group of groups) {
      const path = [...parents, group.name];
      for (const course of group.courses ?? []) {
        result.push({ courseCode: course.courseCode, courseName: course.courseName, credits: course.credits, semesters: course.semesters ?? [], path });
      }
      visit(group.children ?? [], path);
    }
  }
  visit(document.moduleGroups ?? [], []);
  for (const minor of document.minorPrograms ?? []) {
    for (const course of minor.courses ?? []) {
      result.push({ courseCode: course.courseCode, courseName: course.courseName, credits: course.credits, semesters: course.semesters ?? [], path: ["辅修方案", minor.name] });
    }
  }
  return result;
}

export type CourseMatchScope = "selected" | "all" | "name" | "both";

export function matchesCourse(course: { courseCode: string; courseName: string }, sourceCode: string, sourceName: string, scope: CourseMatchScope): boolean {
  if (scope === "name") return course.courseName === sourceName;
  if (scope === "both") return course.courseCode === sourceCode && course.courseName === sourceName;
  return course.courseCode === sourceCode;
}

export function correctDocumentCourse(document: ProgramDocument, sourceCode: string, code: string, name: string, credits?: number, sourceName = "", scope: CourseMatchScope = "all"): ProgramDocument {
  const result = structuredClone(document);
  function correct(courses: ModuleCourse[] = []) {
    for (const course of courses) {
      if (matchesCourse(course, sourceCode, sourceName, scope)) {
        course.courseCode = code;
        course.courseName = name;
        if (credits !== undefined) course.credits = credits;
      }
    }
  }
  function visit(groups: ModuleGroup[]) {
    for (const group of groups) {
      correct(group.courses);
      visit(group.children ?? []);
    }
  }
  visit(result.moduleGroups ?? []);
  for (const minor of result.minorPrograms ?? []) correct(minor.courses);
  return result;
}
