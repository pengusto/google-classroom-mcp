import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { google } from 'googleapis';
import { authorizeDesktop } from '../dist/login.js';

const scopes = ['https://www.googleapis.com/auth/classroom.courses'];
const client = () => new google.auth.OAuth2('test-client', 'test-secret', 'http://localhost');
const callback = authorization => {
  const url = new URL(authorization.searchParams.get('redirect_uri'));
  url.searchParams.set('state', authorization.searchParams.get('state'));
  url.searchParams.set('code', 'test-code');
  return url;
};
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

test('desktop login binds loopback, validates callback and exchanges code with PKCE', async () => {
  const auth = client();
  let calls = 0;
  let authorization;
  auth.getToken = async options => {
    calls++;
    assert.equal(options.code, 'test-code');
    assert.equal(options.redirect_uri, authorization.searchParams.get('redirect_uri'));
    assert.match(options.codeVerifier, /^[A-Za-z0-9._~-]{43,128}$/);
    assert.equal(createHash('sha256').update(options.codeVerifier).digest('base64url'), authorization.searchParams.get('code_challenge'));
    return { tokens: { access_token: 'test-access', scope: scopes.join(' ') } };
  };
  let target;
  const result = await authorizeDesktop(auth, scopes, { openBrowser: async raw => {
    authorization = new URL(raw);
    assert.equal(authorization.origin, 'https://accounts.google.com');
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.get('access_type'), 'offline');
    assert.equal(authorization.searchParams.get('scope'), scopes.join(' '));
    assert.match(authorization.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/);
    target = callback(authorization);
    assert.equal(target.hostname, '127.0.0.1');
    const wrongPath = new URL(target); wrongPath.pathname = '/unrelated';
    assert.equal((await fetch(wrongPath)).status, 404);
    assert.equal((await fetch(target, { method: 'POST' })).status, 404);
    const wrongState = new URL(target); wrongState.searchParams.set('state', 'wrong');
    assert.equal((await fetch(wrongState)).status, 403);
    const duplicateState = new URL(target); duplicateState.searchParams.append('state', authorization.searchParams.get('state'));
    assert.equal((await fetch(duplicateState)).status, 403);
    const missingCode = new URL(target); missingCode.searchParams.delete('code');
    assert.equal((await fetch(missingCode)).status, 400);
    const duplicateCode = new URL(target); duplicateCode.searchParams.append('code', 'second-code');
    assert.equal((await fetch(duplicateCode)).status, 400);
    const malformed = await new Promise((resolve, reject) => {
      const req = request({ hostname: target.hostname, port: target.port, path: 'http://[', method: 'GET' }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end();
    });
    assert.equal(malformed, 400);
    const wrongHost = await new Promise((resolve, reject) => {
      const req = request(target, { headers: { Host: 'attacker.invalid' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end();
    });
    assert.equal(wrongHost, 404);
    assert.equal(calls, 0);
    const response = await fetch(target);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert(!((await response.text()).includes('test-access')));
  } });
  assert.equal(result, auth);
  assert.equal(calls, 1);
  assert.equal(auth.credentials.access_token, 'test-access');
  await assert.rejects(fetch(target));
});

test('desktop login rejects consent denial and token failure without exposing server data', async () => {
  for (const declined of [true, false]) {
    const auth = client(); let calls = 0; let target;
    auth.getToken = async () => { calls++; throw new Error('private-server-detail'); };
    await assert.rejects(authorizeDesktop(auth, scopes, { openBrowser: async raw => {
      target = callback(new URL(raw));
      if (declined) target.searchParams.set('error', 'private-server-detail');
      const response = await fetch(target);
      assert.equal(response.status, declined ? 200 : 502);
      assert(!((await response.text()).includes('private-server-detail')));
    } }), error => {
      assert.equal(error.message, declined ? 'Desktop authorization was declined.' : 'Desktop token exchange failed.');
      return true;
    });
    assert.equal(calls, declined ? 0 : 1);
    assert.deepEqual(auth.credentials, {});
    await assert.rejects(fetch(target));
  }
});

test('desktop login closes the listener on browser failure and timeout', async () => {
  for (const failBrowser of [true, false]) {
    let target;
    await assert.rejects(authorizeDesktop(client(), scopes, { timeoutMs: 500, openBrowser: async raw => {
      target = callback(new URL(raw));
      if (failBrowser) throw new Error('private-launch-detail');
    } }), { message: failBrowser ? 'Could not open the authorization browser.' : 'Desktop authorization timed out.' });
    assert(target);
    await assert.rejects(fetch(target));
  }
});

test('desktop login exchanges once and ignores late tokens after timeout', async () => {
  const auth = client(); const opened = deferred(); const exchanging = deferred(); const tokens = deferred();
  let calls = 0;
  auth.getToken = async () => { calls++; exchanging.resolve(); return tokens.promise; };
  const result = authorizeDesktop(auth, scopes, { timeoutMs: 1500, openBrowser: async raw => opened.resolve(new URL(raw)) });
  const rejection = assert.rejects(result, { message: 'Desktop authorization timed out.' });
  const target = callback(await opened.promise);
  const first = fetch(target).catch(() => undefined);
  await exchanging.promise;
  assert.equal((await fetch(target)).status, 409);
  await rejection;
  tokens.resolve({ tokens: { access_token: 'late-test-token' } });
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.deepEqual(auth.credentials, {});
  await assert.rejects(fetch(target));
});
