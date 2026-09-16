import { load } from "cheerio";
import { assertAllowedUrl, assertPublicWebsite, createSourceFetcher } from "./website-fetch";

export const WEBSITE_SOURCES = [
  { id: "turing", name: "TuringCourses", baseUrl: "https://zju-turing.github.io/TuringCourses/" },
  { id: "bms", name: "BMS Database", baseUrl: "https://bms-zju.github.io/BMS_Database/" },
] as const;
export type WebsiteLink = { title: string; url: string; resourceScope?: 'GENERAL' | 'COURSE' };
type Source = { id: string; name: string; baseUrl: string; startUrl?: string; custom?: boolean };

export function resolveSource(input: string): Source {
  const value = input.trim();
  const byName = WEBSITE_SOURCES.find(
    (s) => s.id === value.toLowerCase() || s.name.toLowerCase() === value.toLowerCase(),
  );
  if (byName) return byName;
  const source = WEBSITE_SOURCES.find((s) => {
    try {
      assertAllowedUrl(value, s.baseUrl);
      return true;
    } catch {
      return false;
    }
  });
  if (source) return source;
  const url = assertPublicWebsite(value);
  const canonical = canonicalizeUrl(url.href);
  return { id: canonical, name: url.hostname, baseUrl: url.origin+'/', startUrl: canonical, custom: true };
}

export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("无效网址");
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^utm_/i.test(key) || /^(fbclid|gclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}

const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s·•_\-—]/g, "");
export function matchCourses(title: string, courses: { code: string; name: string }[]) {
  const normalized = normalize(title);
  const codeMatches = courses.filter((c) =>
    new RegExp(
      `(?:^|[^a-z0-9])${c.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`,
      "i",
    ).test(title),
  );
  const matches = codeMatches.length
    ? codeMatches
    : courses.filter((c) => normalize(c.name) === normalized);
  const courseCodes = [...new Set(matches.map((c) => c.code))];
  return {
    courseCodes,
    matchReason: courseCodes.length
      ? `${codeMatches.length ? "课程号" : "标准化课程名"}匹配${courseCodes.length > 1 ? "（多个候选，请人工确认）" : ""}`
      : "未匹配，请人工选择课程",
  };
}

function pathKind(
  url: string,
  source: ReturnType<typeof resolveSource>,
): "course" | "directory" | undefined {
  const relative = new URL(url).pathname
    .slice(new URL(source.baseUrl).pathname.length)
    .replace(/\/$/, "");
  if (!relative) return "directory";
  if (source.custom) return /\.(?:pdf|zip|rar|7z|png|jpg|jpeg|svg|gif|css|js|ico|mp4|mp3|woff2?)$/i.test(relative) ? undefined : 'course';
  if (source.id === "turing") {
    if (
      /^(political|general|math_phys|short_term|others|major\/(mandatory|elective)|general\/(core|elective|others))$/.test(
        relative,
      )
    )
      return "directory";
    if (
      /^(political|math_phys|major|short_term|others)\/[^/.]+$/.test(relative) ||
      /^general\/(core|elective|others)\/[^/.]+$/.test(relative)
    )
      return "course";
  } else {
    if (/^(courses|mandatory|elective|general)$/.test(relative)) return "directory";
    if (/^(mandatory|elective|general)\/[^/.]+$/.test(relative)) return "course";
  }
  return undefined;
}

function links(html: string, pageUrl: string, sourceId: string) {
  const source = resolveSource(sourceId);
  assertAllowedUrl(pageUrl, source.baseUrl);
  const $ = load(html),
    found = new Map<string, WebsiteLink & { kind: "course" | "directory" }>();
  $("a[href]").each((_, element) => {
    const anchor = $(element),
      href = anchor.attr("href")?.trim();
    if (
      !href ||
      href.startsWith("#") ||
      anchor.closest("footer,.md-footer,header,.md-header").length
    )
      return;
    try {
      const url = canonicalizeUrl(new URL(href, pageUrl).href);
      assertAllowedUrl(url, source.baseUrl);
      const kind = pathKind(url, source);
      const title = (anchor.find(".course-catalog-name").first().text() || anchor.text())
        .replace(/\s+/g, " ")
        .trim();
      if (
        !kind ||
        !title ||
        title.length > 200 ||
        /^(课程主页|上一页|下一页|首页|主页|首页 Home|Home|Next|Previous|登录|注册|搜索|Login|Search|关于|About|返回顶部|编辑此页)$/i.test(title) ||
        /\/(?:login|logout|signin|signup|search)(?:[/?]|$)/i.test(url)
      )
        return;
      if (!found.has(url) || anchor.hasClass("course-catalog-item"))
        found.set(url, { title, url, kind });
    } catch {
      /* Ignore unsupported and out-of-source links. */
    }
  });
  return [...found.values()];
}

export function parseCourseLinks(html: string, pageUrl: string, sourceId: string): WebsiteLink[] {
  return links(html, pageUrl, sourceId)
    .filter((x) => x.kind === "course")
    .map(({ title, url }) => ({ title, url }));
}

export async function scanSource(
  sourceId: string,
  callbacks?: {
    onProgress?: (items: WebsiteLink[], scanned: number, errors: string[]) => Promise<void>;
    isCancelled?: () => Promise<boolean>;
  },
): Promise<{ items: WebsiteLink[]; scanned: number; errors: string[] }> {
  const source = resolveSource(sourceId),
    fetchPage = createSourceFetcher(source.baseUrl);
  const queue = [source.startUrl || source.baseUrl],
    visited = new Set<string>(),
    items = new Map<string, WebsiteLink>(),
    errors: string[] = [];
  let scanned = 0;
  while (queue.length && scanned < 60 && items.size < 30) {
    if (await callbacks?.isCancelled?.()) break;
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    scanned++;
    try {
      const page = await fetchPage(url);
      if (await callbacks?.isCancelled?.()) break;
      if (source.custom && !items.size) {
        const $ = load(page.html);
        const heading = $('h1').first().text().replace(/¶/g, '').trim();
        const title = ((/^(首页|主页|Home)$/i.test(heading) ? $('title').text() : heading) || $('title').text() || source.name).replace(/\s+/g,' ').trim().slice(0,120);
        items.set(page.url, {title, url:page.url, resourceScope:'GENERAL'});
      }
      for (const link of links(page.html, page.url, source.id)) {
        if (link.kind === "course" && items.size < 30 && !items.has(link.url))
          items.set(link.url, { title: link.title, url: link.url });
        if (
          (link.kind === "directory" || source.custom) &&
          !visited.has(link.url) &&
          !queue.includes(link.url) &&
          queue.length + visited.size < (source.custom ? 12 : 60)
        )
          queue.push(link.url);
      }
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : "扫描失败"}`);
    }
    await callbacks?.onProgress?.([...items.values()], scanned, [...errors]);
  }
  return { items: [...items.values()], scanned, errors };
}
