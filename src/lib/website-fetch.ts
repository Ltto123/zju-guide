import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { request as httpRequest } from "node:http";
import { isIP } from "node:net";

const AGENT = "ZjuGuideImporter";
const MAX_BYTES = 2 * 1024 * 1024;
export function assertPublicWebsite(input: string): URL {
  const url = new URL(input);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port ||
      host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      !host.includes('.') && !isIP(host) || isIP(host) && !isPublicAddress(host))
    throw new Error('请输入不含账号密码的公开 HTTP/HTTPS 网站地址');
  return url;
}

export function assertAllowedUrl(input: string, baseUrl: string, robots = false): URL {
  const url = assertPublicWebsite(input);
  const base = assertPublicWebsite(baseUrl);
  if (
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    !(url.pathname.startsWith(base.pathname) || (robots && url.pathname === "/robots.txt"))
  ) {
    throw new Error("网址不在来源白名单内");
  }
  return url;
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || b === 2 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6) return false;
  // Restrict IPv6 to global unicast; reject mapped IPv4 and transition/special ranges.
  const expanded = address.toLowerCase();
  if (!/^[23][0-9a-f]{3}:/.test(expanded)) return false;
  return !/^(2001:(?:0{1,4}:|0?db8:|0?2:|0?1[0-9a-f]:)|2002:|3fff:)/.test(expanded);
}

type Rule = { allow: boolean; path: string };
export function robotsAllows(text: string, input: string): boolean {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let group = { agents: [] as string[], rules: [] as Rule[] };
  let hasRules = false;
  for (const line of text.split(/\r?\n/)) {
    const match = line
      .replace(/#.*$/, "")
      .trim()
      .match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!.toLowerCase(),
      value = match[2]!.trim();
    if (key === "user-agent") {
      if (hasRules) {
        groups.push(group);
        group = { agents: [], rules: [] };
        hasRules = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (key === "allow" || key === "disallow") {
      hasRules = true;
      if (value) group.rules.push({ allow: key === "allow", path: value });
    }
  }
  groups.push(group);
  const specific = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && AGENT.toLowerCase().startsWith(a)),
  );
  const selected = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const url = new URL(input);
  const path = url.pathname + url.search;
  const matching = selected
    .flatMap((g) => g.rules)
    .filter((rule) => {
      const end = rule.path.endsWith("$");
      const pattern = (end ? rule.path.slice(0, -1) : rule.path)
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      return new RegExp("^" + pattern + (end ? "$" : "")).test(path);
    })
    .sort(
      (a, b) =>
        b.path.replace(/[*$]/g, "").length - a.path.replace(/[*$]/g, "").length ||
        Number(b.allow) - Number(a.allow),
    );
  return matching[0]?.allow ?? true;
}

class FetchError extends Error {
  constructor(
    message: string,
    readonly transient = false,
  ) {
    super(message);
  }
}

async function fetchOnce(
  url: URL,
): Promise<{ status: number; location?: string; body: string; contentType: string }> {
  // DNS is validated for every request, then pinned in the socket lookup callback.
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new FetchError("DNS 查询超时", true)), 10000);
      timer.unref();
    }),
  ]);
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new FetchError("来源 DNS 包含非公网地址");
  const address = addresses[0]!;
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'http:' ? httpRequest : request)(
      url,
      {
        method: "GET",
        agent: false,
        headers: {
          "User-Agent": `${AGENT}/1.0`,
          Accept: "text/html,text/plain;q=0.9",
          "Accept-Encoding": "identity",
        },
        lookup: (_hostname, options, callback) => {
          if (typeof options === "object" && options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (res) => {
        if (Number(res.headers["content-length"] || 0) > MAX_BYTES) {
          req.destroy(new FetchError("响应超过 2 MB"));
          return;
        }
        if (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") {
          req.destroy(new FetchError("不支持压缩响应"));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) req.destroy(new FetchError("响应超过 2 MB"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            location: res.headers.location,
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: res.headers["content-type"] || "",
          }),
        );
      },
    );
    const timer = setTimeout(() => req.destroy(new FetchError("请求超时", true)), 10000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", (error) => reject(error));
    req.end();
  });
}

// Shared per-host spacing also covers robots, redirects, retries and concurrent jobs.
const slots = new Map<string, number>();
async function throttle(host: string) {
  const now = Date.now(),
    start = Math.max(now, slots.get(host) || 0);
  slots.set(host, start + 1000);
  if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
}

export function createSourceFetcher(baseUrl: string) {
  let robots: string | undefined;
  async function raw(input: string, isRobots = false) {
    let url = assertAllowedUrl(input, baseUrl, isRobots);
    for (let redirects = 0; redirects <= 4; redirects++) {
      if (!isRobots && robots !== undefined && !robotsAllows(robots, url.href))
        throw new FetchError("robots.txt 禁止访问此页面");
      let result: Awaited<ReturnType<typeof fetchOnce>> | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        await throttle(url.hostname);
        try {
          result = await fetchOnce(url);
          if (result.status === 429 || result.status >= 500)
            throw new FetchError(`来源返回 HTTP ${result.status}`, true);
          break;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (
            attempt ||
            !(
              (error instanceof FetchError && error.transient) ||
              ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(code || "")
            )
          )
            throw error;
        }
      }
      if (!result) throw new FetchError("请求失败");
      if ([301, 302, 303, 307, 308].includes(result.status)) {
        if (!result.location) throw new FetchError("重定向缺少目标");
        url = assertAllowedUrl(new URL(result.location, url).href, baseUrl, isRobots);
        continue;
      }
      return { ...result, url: url.href };
    }
    throw new FetchError("重定向次数过多");
  }
  return async (input: string): Promise<{ html: string; url: string }> => {
    assertAllowedUrl(input, baseUrl);
    if (robots === undefined) {
      const result = await raw(new URL("/robots.txt", baseUrl).href, true);
      if (result.status === 404 || result.status === 410) robots = "";
      else if (result.status === 200 && /text\/plain/i.test(result.contentType))
        robots = result.body;
      else throw new FetchError("无法确认 robots.txt 规则，已停止扫描");
    }
    const result = await raw(input);
    if (result.status !== 200) throw new FetchError(`来源返回 HTTP ${result.status}`);
    if (!/text\/html|application\/xhtml\+xml/i.test(result.contentType))
      throw new FetchError("来源页面不是 HTML");
    return { html: result.body, url: result.url };
  };
}
