// Validate the effective Compose configuration, without a Docker daemon.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const config = JSON.parse(execFileSync('docker', ['compose', '-f', 'docker/docker-compose.yml',
  '-f', 'docker/website-import.compose.yml', 'config', '--format', 'json'], {
  encoding: 'utf8', env: { ...process.env, WEBSITE_IMPORT_ENABLED: 'true' },
}));
const { app, 'website-import-worker': worker, 'website-import-migrate': migrate } = config.services;
assert.ok(worker, 'Documented compose command must actually start the worker without a hidden profile');
assert.ok(migrate, 'Deployment must apply migrations before starting consumers');
assert.equal(app.depends_on['website-import-migrate'].condition, 'service_completed_successfully');
assert.equal(worker.depends_on['website-import-migrate'].condition, 'service_completed_successfully');
assert.deepEqual(app.command, ['node', 'server.js'], 'Production overlay must not repeat db push/seed');
assert.ok(migrate.command.join(' ').includes('migrate deploy'));
assert.equal(worker.environment.DATABASE_URL, app.environment.DATABASE_URL);
assert.equal(migrate.environment.DATABASE_URL, app.environment.DATABASE_URL);
assert.equal(app.environment.WEBSITE_IMPORT_ENABLED, 'true');
assert.equal(worker.environment.WEBSITE_IMPORT_ENABLED, 'true');
console.log('Website import deployment configuration passed');
