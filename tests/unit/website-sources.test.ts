import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import {
  canonicalizeUrl,
  resolveSource,
  parseCourseLinks,
  matchCourses,
  scanSource,
} from "../../src/lib/website-sources";
import {
  isPublicAddress,
  robotsAllows,
  assertAllowedUrl,
  createSourceFetcher,
} from "../../src/lib/website-fetch";

const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("node:https", () => ({ request: network.request }));

const base = "https://zju-turing.github.io/TuringCourses/";
const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/website-import/${name}.html`, import.meta.url), "utf8");
describe("website source boundaries", () => {
  it("resolves known names and custom public URLs", () => {
    expect(resolveSource("TuringCourses").id).toBe("turing");
    expect(resolveSource("BMS Database").id).toBe("bms");
    expect(resolveSource(base + "math_phys/").id).toBe("turing");
    expect(resolveSource('https://ckc-agc.bowling233.top/').id).toBe('https://ckc-agc.bowling233.top/');
    for (const value of ['unknown name','http://127.0.0.1/','https://localhost/', 'https://10.0.0.1/', 'ftp://example.org/', 'https://example.org:8080/', 'https://a:b@example.org/'])
      expect(() => resolveSource(value)).toThrow();
  });
  it('extracts custom same-site pages and ignores unrelated navigation', () => {
    const site='https://ckc-agc.bowling233.top/';
    expect(parseCourseLinks('<nav><a href="/math/">数学分析</a></nav><main><a href="/cs/">数据结构基础</a><a href="https://elsewhere.org/">外部广告</a><a href="/login">登录</a></main>', site, site)).toEqual([
      {title:'数学分析',url:site+'math/'}, {title:'数据结构基础',url:site+'cs/'}
    ]);
    expect(()=>assertAllowedUrl('https://elsewhere.org/',site)).toThrow();
  });
  it("drops tracking and fragment but retains semantic parameters", () => {
    expect(canonicalizeUrl(base + "major/data_structure/?utm_source=x&year=2025#notes")).toBe(
      base + "major/data_structure/?year=2025",
    );
  });
  it("finds real Turing courses without category pages", () => {
    const links = parseCourseLinks(fixture("turing-home"), base, "turing");
    expect(links).toContainEqual({ title: "数据结构基础", url: base + "major/data_structure/" });
    expect(links.some((x) => /mandatory\/$|elective\/$|contributing|changelog/.test(x.url))).toBe(
      false,
    );
    expect(links.length).toBeGreaterThan(20);
  });
  it("uses BMS course names instead of card metadata", () => {
    const links = parseCourseLinks(
      fixture("bms-courses"),
      "https://bms-zju.github.io/BMS_Database/courses/",
      "bms",
    );
    expect(links).toContainEqual({
      title: "医学生命基础",
      url: "https://bms-zju.github.io/BMS_Database/mandatory/medical_life_fundamentals/",
    });
    expect(links.every((x) => !x.title.includes("学分") && !x.url.includes("zju-turing"))).toBe(
      true,
    );
  });
  it("excludes fragments, downloads, homepage links and external URLs", () => {
    const html =
      '<a href="#notes">笔记</a><a href=".">主页</a><a href="major/data_structure/">数据结构</a><a href="major/data_structure/?utm_source=x">数据结构</a><a href="major/test.pdf">资料</a><a href="https://evil.test/x">外部</a>';
    expect(parseCourseLinks(html, base, "turing")).toEqual([
      { title: "数据结构", url: base + "major/data_structure/" },
    ]);
  });
  it("matches normalized names and exact course codes, leaves ambiguous names for review", () => {
    const courses = [
      { code: "MATH1", name: "微积分（甲）Ⅰ" },
      { code: "MED1", name: "医学生命基础" },
      { code: "MED2", name: "医学生命基础" },
    ];
    expect(matchCourses("微积分(甲)I", courses).courseCodes).toEqual(["MATH1"]);
    expect(matchCourses("MED1 医学生命基础", courses).courseCodes).toEqual(["MED1"]);
    expect(matchCourses("医学生命基础", courses).courseCodes).toEqual(["MED1", "MED2"]);
    expect(matchCourses("微积分", courses).courseCodes).toEqual([]);
  });
});

describe("bounded scans and transport", () => {
  let mockedNow = Date.now();
  type Reply = { status?: number; body?: string; headers?: Record<string, string> };
  function replies(values: Reply[]) {
    network.request.mockImplementation((_url, _options, handler) => {
      const reply = values.shift();
      if (!reply) throw new Error("Unexpected request");
      const req = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error: Error) => void;
      };
      req.destroy = (error) => {
        req.emit("error", error);
        req.emit("close");
      };
      req.end = () =>
        queueMicrotask(() => {
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
            headers: Record<string, string>;
          };
          res.statusCode = reply.status || 200;
          res.headers = { "content-type": "text/html", ...reply.headers };
          handler(res);
          res.emit("data", Buffer.from(reply.body || ""));
          res.emit("end");
          req.emit("close");
        });
      return req;
    });
  }
  beforeEach(() => {
    vi.clearAllMocks();
    network.lookup.mockResolvedValue([{ address: "185.199.108.153", family: 4 }]);
    vi.spyOn(Date, "now").mockImplementation(() => (mockedNow += 100000));
  });
  afterEach(() => vi.restoreAllMocks());
  it("discovers BMS directory and stops at thirty candidates", async () => {
    replies([{ status: 404 }, { body: fixture("bms-home") }, { body: fixture("bms-courses") }]);
    const progress = vi.fn();
    const result = await scanSource("bms", { onProgress: progress });
    expect(result.items).toHaveLength(30);
    expect(result.scanned).toBe(2);
    expect(result.errors).toEqual([]);
    expect(progress).toHaveBeenCalledTimes(2);
  });
  it("cancels before network access", async () => {
    expect(await scanSource("turing", { isCancelled: async () => true })).toEqual({
      items: [],
      scanned: 0,
      errors: [],
    });
    expect(network.request).not.toHaveBeenCalled();
  });
  it("fails closed on unexpected robots errors", async () => {
    replies([{ status: 403 }]);
    await expect(createSourceFetcher(base)(base)).rejects.toThrow("robots");
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it("enforces robot rules before requesting pages", async () => {
    replies([
      {
        body: "User-agent: *\nDisallow: /TuringCourses/",
        headers: { "content-type": "text/plain" },
      },
    ]);
    await expect(createSourceFetcher(base)(base)).rejects.toThrow("robots");
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it("rejects private DNS before opening a socket", async () => {
    network.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(createSourceFetcher(base)(base)).rejects.toThrow("非公网");
    expect(network.request).not.toHaveBeenCalled();
  });
  it("pins the validated address in the HTTPS lookup", async () => {
    replies([{ status: 404 }, { body: "<html/>" }]);
    await createSourceFetcher(base)(base);
    const options = network.request.mock.calls[1]![1];
    const cb = vi.fn();
    options.lookup("zju-turing.github.io", {}, cb);
    expect(cb).toHaveBeenCalledWith(null, "185.199.108.153", 4);
  });
  it("rejects external redirects", async () => {
    replies([{ status: 404 }, { status: 302, headers: { location: "https://127.0.0.1/" } }]);
    await expect(createSourceFetcher(base)(base)).rejects.toThrow();
    expect(network.request).toHaveBeenCalledTimes(2);
  });
  it("caps streamed response bytes even without content length", async () => {
    replies([{ status: 404 }, { body: "x".repeat(2 * 1024 * 1024 + 1) }]);
    await expect(createSourceFetcher(base)(base)).rejects.toThrow("2 MB");
  });
  it("retries a transient response only once", async () => {
    replies([{ status: 404 }, { status: 503 }, { status: 503 }]);
    await expect(createSourceFetcher(base)(base)).rejects.toThrow("503");
    expect(network.request).toHaveBeenCalledTimes(3);
  });
});
describe("public fetching guards", () => {
  it("blocks private, mapped, special and malformed addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.2",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
      "garbage",
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
    expect(isPublicAddress("185.199.108.153")).toBe(true);
    expect(isPublicAddress("2606:50c0:8000::153")).toBe(true);
  });
  it("limits redirects to the configured source and robots endpoint", () => {
    expect(() => assertAllowedUrl(base, base)).not.toThrow();
    for (const url of [
      "https://127.0.0.1/",
      "https://bms-zju.github.io/BMS_Database/",
      base + "../foo",
      base.replace("https://", "https://user:pass@"),
      base.replace("github.io/", "github.io:444/"),
    ])
      expect(() => assertAllowedUrl(url, base)).toThrow();
  });
  it("respects longest robot rules and specific agent groups", () => {
    const rules = "User-agent: *\nDisallow: /TuringCourses/\nAllow: /TuringCourses/major/\n";
    expect(robotsAllows(rules, base + "math_phys/")).toBe(false);
    expect(robotsAllows(rules, base + "major/data_structure/")).toBe(true);
    expect(
      robotsAllows("User-agent: ZjuGuideImporter\nDisallow: /\nUser-agent: *\nAllow: /", base),
    ).toBe(false);
  });
});
