import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { scopes, hasRequiredScopes, saveToken } from '../dist/auth.js';

test('scope checks and atomic private token persistence', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classroom-auth-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert(hasRequiredScopes({ scope: scopes.join(' ') }));
  assert(!hasRequiredScopes({ scope: scopes.slice(1).join(' ') }));
  assert(!hasRequiredScopes({}));
  const target = path.join(dir, 'token.json');
  saveToken({ access_token: 'test-value' }, target);
  assert.equal(JSON.parse(fs.readFileSync(target)).access_token, 'test-value');
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  saveToken({ access_token: 'updated-test-value' }, target);
  assert.deepEqual(fs.readdirSync(dir), ['token.json']);
  const blocked = path.join(dir, 'directory'); fs.mkdirSync(blocked);
  assert.throws(() => saveToken({}, blocked));
  assert(fs.statSync(blocked).isDirectory());
  assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.tmp')), false);
});

test('OAuth refresh preserves refresh token and scopes without calling Google', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classroom-refresh-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const credentials = path.join(dir, 'credentials.json'); const token = path.join(dir, 'token.json');
  fs.writeFileSync(credentials, JSON.stringify({ installed: { client_id: 'test-client', client_secret: 'test-secret', redirect_uris: ['http://localhost'] } }));
  saveToken({ scope: scopes.join(' '), refresh_token: 'test-refresh', access_token: 'old-test-value' }, token);
  const moduleUrl = pathToFileURL(path.resolve('dist/auth.js')).href;
  execFileSync(process.execPath, ['--input-type=module', '-e', `const {loadAuthClient}=await import(${JSON.stringify(moduleUrl)});const auth=loadAuthClient();auth.emit('tokens',{access_token:'new-test-value'});`], {
    env: { ...process.env, GOOGLE_CREDENTIALS_PATH: credentials, GOOGLE_TOKEN_PATH: token }, stdio: 'pipe',
  });
  const saved = JSON.parse(fs.readFileSync(token));
  assert.equal(saved.access_token, 'new-test-value');
  assert.equal(saved.refresh_token, 'test-refresh');
  assert.equal(saved.scope, scopes.join(' '));
});

test('doctor fails safely without starting consent or printing invalid file contents', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classroom-doctor-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const credentials = path.join(dir, 'credentials.json');
  for (const invalid of [false, true]) {
    if (invalid) fs.writeFileSync(credentials, '{private-test-value');
    try {
      execFileSync(process.execPath, ['auth.js', '--check'], { env: { ...process.env, GOOGLE_CREDENTIALS_PATH: credentials, GOOGLE_TOKEN_PATH: path.join(dir, 'token.json') }, stdio: 'pipe', timeout: 10000 });
      assert.fail('doctor must fail');
    } catch (error) {
      assert.equal(error.status, 1);
      assert.match(error.stderr.toString(), invalid ? /not valid JSON/ : /file missing/);
      assert(!error.stderr.toString().includes('private-test-value'));
    }
  }
});
