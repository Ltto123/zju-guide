"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { Upload, FileJson, CheckCircle, AlertTriangle, XCircle, ArrowRight } from "lucide-react";

interface NormalizedCourse {
  code: string;
  name: string;
  credits: number;
  semester: number;
  grade?: string;
}

interface ImportResult {
  importId: string;
  coursesAdded: number;
  coursesSkipped: number;
  courses: NormalizedCourse[];
}

export default function ImportPage() {
  const router = useRouter();
  const [rawJson, setRawJson] = useState("");
  const [preview, setPreview] = useState<NormalizedCourse[] | null>(null);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState("");

  const handleFile = useCallback((file: File) => {
    setParseError("");
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setRawJson(text);
      tryParse(text);
    };
    reader.readAsText(file);
  }, []);

  const tryParse = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      // Try to extract courses from either format
      const courses = parsed.courses ?? parsed.records ?? [];
      if (!Array.isArray(courses) || courses.length === 0) {
        setParseError("JSON 中没有找到课程数据（需要 courses 或 records 数组）");
        setPreview(null);
        return;
      }
      // Show a preview of what we can extract
      const previewCourses: NormalizedCourse[] = courses.map((c: Record<string, unknown>) => {
        const grade = c.grade ?? c.result;
        return {
          code: (c.code ?? c.courseId ?? "?") as string,
          name: (c.name ?? c.title ?? "?") as string,
          credits: (c.credits ?? c.credit ?? 0) as number,
          semester: (c.semester ?? c.term ?? 0) as number,
          grade:
            typeof grade === "string" || typeof grade === "number"
              ? String(grade)
              : undefined,
        };
      });
      setPreview(previewCourses);
      setParseError("");
    } catch {
      setParseError("JSON 格式错误，请检查");
      setPreview(null);
    }
  };

  const handleImport = async () => {
    if (!rawJson) return;
    setImporting(true);
    setImportError("");
    try {
      const data = await api.post<ImportResult>("/api/me/imports", JSON.parse(rawJson));
      setResult(data);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setImportError(err.message);
      } else {
        setImportError("导入失败");
      }
    } finally {
      setImporting(false);
    }
  };

  const handlePaste = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setRawJson(text);
    setResult(null);
    if (text.trim()) {
      tryParse(text);
    } else {
      setPreview(null);
      setParseError("");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Upload className="h-6 w-6 text-blue-600" />
        <h2 className="text-xl font-bold text-slate-900">导入教务数据</h2>
      </div>

      <p className="text-sm text-slate-500">
        上传或粘贴从教务系统导出的 JSON 文件。系统会自动脱敏（移除学号/身份证号），识别课程并生成学习路径。
      </p>

      {/* ---- Step 1: Upload / Paste ---- */}
      {!result && (
        <>
          {/* File drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center transition hover:border-blue-400 hover:bg-blue-50/50"
          >
            <FileJson className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">
              拖拽 JSON 文件到这里
            </p>
            <p className="mt-1 text-xs text-slate-400">或</p>
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-blue-500">
              <Upload className="h-4 w-4" />
              选择文件
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </label>
          </div>

          {/* Paste zone */}
          <div>
            <p className="mb-2 text-sm font-medium text-slate-600">或直接粘贴 JSON：</p>
            <textarea
              value={rawJson}
              onChange={handlePaste}
              placeholder='{"major":"材料科学与工程","year":2025,"courses":[...]}'
              rows={8}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-mono text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Parse error */}
          {parseError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              <XCircle className="h-4 w-4 shrink-0" />
              {parseError}
            </div>
          )}

          {/* Preview */}
          {preview && !parseError && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="font-semibold text-slate-900">
                  预览（{preview.length} 门课程）
                </h3>
                <p className="text-xs text-slate-400">
                  确认无误后点击"导入"按钮。系统会自动去重，已存在的课程不会重复导入。
                </p>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-slate-600">课号</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-600">名称</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-600">学分</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-600">学期</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-600">成绩</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.map((c, i) => (
                      <tr key={i}>
                        <td className="course-code px-4 py-2 text-blue-600">{c.code}</td>
                        <td className="px-4 py-2 text-slate-700">{c.name}</td>
                        <td className="px-4 py-2 text-slate-500">{c.credits}</td>
                        <td className="px-4 py-2 text-slate-500">第{c.semester}学期</td>
                        <td className="px-4 py-2 text-slate-500">{c.grade ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-100 px-4 py-3">
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow transition hover:bg-blue-500 disabled:opacity-50"
                >
                  {importing ? "导入中..." : "确认导入"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {importError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              <XCircle className="h-4 w-4 shrink-0" />
              {importError}
            </div>
          )}
        </>
      )}

      {/* ---- Step 2: Result ---- */}
      {result && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">导入成功</h3>
              <p className="text-sm text-slate-500">
                新增 {result.coursesAdded} 门课程，跳过 {result.coursesSkipped} 门已存在课程
              </p>
            </div>
          </div>

          {result.courses.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">课号</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">名称</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">学分</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">学期</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.courses.map((c, i) => (
                    <tr key={i}>
                      <td className="course-code px-4 py-2 text-blue-600">{c.code}</td>
                      <td className="px-4 py-2 text-slate-700">{c.name}</td>
                      <td className="px-4 py-2 text-slate-500">{c.credits}</td>
                      <td className="px-4 py-2 text-slate-500">第{c.semester}学期</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex gap-3">
            <button
              onClick={() => router.push("/")}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow transition hover:bg-blue-500"
            >
              查看学习路径
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                setRawJson("");
                setPreview(null);
                setResult(null);
              }}
              className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              导入更多
            </button>
          </div>
        </div>
      )}

      {/* ---- Fixture quick-load ---- */}
      {!result && !preview && !rawJson && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="mb-2 text-xs font-medium text-slate-500">快速测试（使用脱敏样例数据）：</p>
          <div className="flex gap-2">
            {["valid", "old-schema"].map((name) => (
              <button
                key={name}
                onClick={async () => {
                  try {
                    const resp = await fetch(`/fixtures/${name}-import.json`);
                    const text = await resp.text();
                    setRawJson(text);
                    tryParse(text);
                  } catch { /* ignore */ }
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-100"
              >
                加载 {name === "valid" ? "新版格式" : "旧版格式"} 样例
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
