import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('stdio starts outside checkout and exposes tools without credentials', async t => {
  const client = new Client({ name: 'stdio-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/index.js')], cwd: os.tmpdir(), stderr: 'pipe', env: { GOOGLE_CREDENTIALS_PATH: '/nonexistent/credentials.json', GOOGLE_TOKEN_PATH: '/nonexistent/token.json' } });
  await client.connect(transport);
  t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 21);
  const response = await client.callTool({ name: 'classroom_list_courses', arguments: { pageSize: 1 } });
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /OAuth is unavailable/);
  assert(!JSON.stringify(response).includes('/nonexistent'));
});
