// Exercise an old PostgreSQL schema -> migration -> real admin API -> worker.
// Uses a unique schema inside a localhost *_test database; never touches public.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, cp, readdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { NextRequest } from 'next/server';

async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.ok(url.pathname.endsWith('_test'));
  const schema = `import_upgrade_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.set('schema', schema);
  process.env.DATABASE_URL = url.href;
  process.env.WEBSITE_IMPORT_ENABLED = 'true';
  process.env.JWT_SECRET = 'isolated-upgrade-test';
  const root = await mkdtemp(join(tmpdir(), 'website-import-upgrade-'));
  const oldSchema = join(root, 'schema.prisma');
  const migrate = (schemaPath: string) => execFileSync(process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', schemaPath],
    { env: process.env, stdio: 'pipe' });
  const { prisma } = await import('../../src/lib/prisma');
  try {
    await copyFile('prisma/schema.prisma', oldSchema);
    await mkdir(join(root, 'migrations'));
    await copyFile('prisma/migrations/migration_lock.toml', join(root, 'migrations/migration_lock.toml'));
    for (const name of await readdir('prisma/migrations')) {
      if (/^\d/.test(name) && name < '20260908160000_website_import')
        await cp(join('prisma/migrations', name), join(root, 'migrations', name), { recursive: true });
    }
    migrate(oldSchema);
    const admin = await prisma.user.create({ data: {
      username: 'upgrade_admin', passwordHash: 'disabled-test-account', role: 'ADMIN',
    } });
    const { signToken } = await import('../../src/lib/auth');
    const { GET, POST } = await import('../../src/app/api/admin/website-imports/route');
    const token = await signToken({ sub: admin.id, role: 'ADMIN' });
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const request = () => new NextRequest('http://localhost/api/admin/website-imports', { headers });
    const before = await GET(request());
    assert.equal(before.status, 503);
    assert.equal((await before.json()).error.code, 'IMPORT_SCHEMA_NOT_READY');
    migrate(resolve('prisma/schema.prisma'));
    assert.equal((await GET(request())).status, 200);
    const created = await POST(new NextRequest('http://localhost/api/admin/website-imports', {
      method: 'POST', headers, body: JSON.stringify({ sourceId: 'turing' }),
    }));
    assert.equal(created.status, 201);
    const job = (await created.json()).data;
    const { runImportOnce } = await import('../../src/lib/website-import-worker');
    const { parseCourseLinks } = await import('../../src/lib/website-sources');
    const html = await readFile('tests/fixtures/website-import/turing-home.html', 'utf8');
    assert.equal(await runImportOnce(async () => ({
      items: parseCourseLinks(html, 'https://zju-turing.github.io/TuringCourses/', 'turing').slice(0, 2),
      scanned: 1, errors: [],
    })), true);
    assert.equal((await prisma.websiteImportJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'COMPLETED');
    assert.equal(await prisma.websiteImportCandidate.count({ where: { jobId: job.id } }), 2);
    // A second deploy is idempotent and must retain queued/imported data.
    migrate(resolve('prisma/schema.prisma'));
    assert.equal(await prisma.websiteImportCandidate.count({ where: { jobId: job.id } }), 2);
    console.log('Old schema 503 -> migrate deploy -> API 200 -> worker persisted candidates; repeated deploy preserved data');
  } finally {
    // schema consists solely of a fixed prefix and random hex, and is owned by this run.
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
