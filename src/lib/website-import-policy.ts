import { z } from "zod";

export const candidateUpdateSchema = z.object({
  resourceScope: z.enum(['COURSE', 'GENERAL']).default('COURSE'),
  title: z.string().trim().min(2).max(120),
  summary: z.string().trim().max(500).default(""),
  type: z.enum([
    "EBOOK",
    "LECTURE_NOTE",
    "EXAM_RECALL",
    "BLOG",
    "CC98_POST",
    "TOOL_TEMPLATE",
    "OTHER",
  ]),
  applicableStage: z.enum(["COURSE", "QUIZ", "MIDTERM", "FINAL"]),
  courseCodes: z
    .array(z.string().trim().min(1).max(100))
    .max(20)
    .transform((codes) => [...new Set(codes)]),
}).refine(data => data.resourceScope === 'GENERAL' ? data.courseCodes.length === 0 : data.courseCodes.length > 0,
  { message: '课程资源需关联课程，通用入口无需课程', path: ['courseCodes'] });
export const selectionSchema = z.object({
  candidateIds: z
    .array(z.string().min(1).max(100))
    .min(1)
    .max(30)
    .transform((ids) => [...new Set(ids)]),
});
export function importDayStart(now = new Date()): Date {
  const offset = 8 * 60 * 60 * 1000;
  return new Date(Math.floor((now.getTime() + offset) / 86400000) * 86400000 - offset);
}
export class ImportError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "IMPORT_ERROR",
  ) {
    super(message);
  }
}
