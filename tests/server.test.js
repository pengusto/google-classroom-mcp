import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { GoogleClassroomServer } from '../dist/index.js';

async function connected(t, classroom = {}, drive = {}, slides = {}) {
  const server = new GoogleClassroomServer();
  server.initApis = async () => ({ classroom, drive, slides });
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.run(a);
  await client.connect(b);
  t.after(() => client.close());
  return client;
}
const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
const data = result => { assert(!result.isError, result.content[0].text); return JSON.parse(result.content[0].text); };

test('tool schemas reject invalid calls before authentication', async t => {
  const server = new GoogleClassroomServer();
  let authenticated = false;
  server.initApis = async () => { authenticated = true; throw new Error('must not authenticate'); };
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.run(a); await client.connect(b); t.after(() => client.close());
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 21);
  assert(tools.some(tool => tool.name === 'drive_upload_file'));
  for (const [name, args] of [
    ['classroom_delete_course', { courseId: 'test' }],
    ['classroom_create_material', { courseId: 'test' }],
    ['classroom_list_courses', { pageSize: 0 }],
    ['classroom_list_courses', { pageSize: 101 }],
    ['classroom_list_courses', { pageSize: 1.5 }],
    ['classroom_list_courses', { unknown: true }],
    ['classroom_create_material', { courseId: 'test', title: 'x', scheduledTime: 'not-a-date' }],
    ['classroom_create_material', { courseId: 'test', title: 'x', scheduledTime: '2030-01-01T00:00:00Z', state: 'PUBLISHED' }],
    ['classroom_create_material', { courseId: 'test', title: 'x', attachments: [{ type: 'link' }] }],
    ['classroom_create_material', { courseId: 'test', title: 'x', attachments: [{ type: 'link', idOrUrl: 'javascript:alert(1)' }] }],
    ['classroom_create_assignment', { courseId: 'test', title: 'x', dueDate: '2030-02-30' }],
    ['classroom_create_assignment', { courseId: 'test', title: 'x', dueTime: '24:10' }],
    ['classroom_patch_material', { courseId: 'test', id: 'x', updateMask: 'state' }],
    ['classroom_patch_material', { courseId: 'test', id: 'x', updateMask: 'state,state', state: 'DRAFT' }],
    ['classroom_patch_material', { courseId: 'test', id: 'x', updateMask: 'ownerId', ownerId: 'x' }],
    ['classroom_update_course', { courseId: 'test' }],
    ['drive_upload_file', { name: 'x', base64Content: 'broken' }],
    ['drive_upload_file', { name: 'x', base64Content: 'Zh==' }],
    ['drive_upload_file', { name: 'x', base64Content: 'eA==', mimeType: 'text/plain\r\nX: bad' }],
    ['drive_upload_file', { name: 'x', base64Content: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') }],
  ]) {
    assert.equal((await call(client, name, args)).isError, true, name);
  }
  assert.equal(authenticated, false);
});

for (const [name, api, key, state] of [
  ['classroom_list_courses', null, 'courses', 'courseStates'],
  ['classroom_list_assignments', 'courseWork', 'courseWork', 'courseWorkStates'],
  ['classroom_list_materials', 'courseWorkMaterials', 'courseWorkMaterial', 'courseWorkMaterialStates'],
  ['classroom_list_announcements', 'announcements', 'announcements', 'announcementStates'],
  ['classroom_list_topics', 'topics', 'topic'],
]) test(`${name}: bounded pages, cursor and filters`, async t => {
  const requests = [];
  const list = async args => {
    requests.push(args);
    return { data: args.pageToken ? {} : { [key]: [{ id: 'first' }], nextPageToken: 'next' } };
  };
  const client = await connected(t, { courses: api ? { [api]: { list } } : { list } });
  const args = api ? { courseId: 'test' } : {};
  const first = data(await call(client, name, { ...args, pageSize: 1 }));
  assert.deepEqual(first, { items: [{ id: 'first' }], nextPageToken: 'next' });
  assert.equal(requests.length, 1);
  const nextArgs = { ...args, pageSize: 1, pageToken: first.nextPageToken, fullData: true };
  if (state) nextArgs[state] = state === 'courseStates' ? ['ACTIVE'] : ['DRAFT'];
  assert.deepEqual(data(await call(client, name, nextArgs)), { items: [], nextPageToken: null });
  assert.equal(requests[1].pageToken, 'next');
  assert.equal(requests[1].pageSize, 1);
  if (state) assert.deepEqual(requests[1][state], nextArgs[state]);
  if (requests[0].fields) assert(requests[0].fields.includes('nextPageToken'));
});

test('search preserves cursor on an empty matching page', async t => {
  const client = await connected(t, { courses: { list: async args => ({ data: args.pageToken
    ? { courses: [{ name: 'Programming' }] }
    : { courses: [{ name: 'Art' }], nextPageToken: 'next' } }) } });
  assert.deepEqual(data(await call(client, 'classroom_search_courses', { query: 'program' })), { items: [], nextPageToken: 'next' });
  assert.deepEqual(data(await call(client, 'classroom_search_courses', { query: 'program', pageToken: 'next' })), { items: [{ name: 'Programming' }], nextPageToken: null });
});

for (const [suffix, api, create] of [['assignment', 'courseWork', 'classroom_create_assignment'], ['material', 'courseWorkMaterials', 'classroom_create_material'], ['announcement', 'announcements', 'classroom_post_announcement']]) {
  test(`${suffix}: draft, explicit publish and reschedule`, async t => {
    const echo = async args => ({ data: args.requestBody });
    const client = await connected(t, { courses: { [api]: { create: echo, patch: echo } } });
    const args = suffix === 'announcement' ? { courseId: 'test', text: 'test' } : { courseId: 'test', title: 'test' };
    assert.equal(data(await call(client, create, args)).state, 'DRAFT');
    assert.equal(data(await call(client, create, { ...args, state: 'PUBLISHED' })).state, 'PUBLISHED');
    const scheduledTime = '2030-01-01T00:00:00Z';
    assert.equal(data(await call(client, create, { ...args, scheduledTime })).state, 'DRAFT');
    assert.equal(data(await call(client, `classroom_patch_${suffix}`, { courseId: 'test', id: 'test', updateMask: 'scheduledTime', scheduledTime })).scheduledTime, scheduledTime);
    assert.equal(data(await call(client, `classroom_patch_${suffix}`, { courseId: 'test', id: 'test', updateMask: 'scheduledTime', scheduledTime: null })).scheduledTime, undefined);
  });
}

test('Drive upload transfers bytes and returns a reusable file ID', async t => {
  let uploaded;
  const client = await connected(t, {}, { files: { create: async args => {
    const chunks = []; for await (const chunk of args.media.body) chunks.push(chunk);
    uploaded = Buffer.concat(chunks).toString();
    return { data: { id: 'file-id' } };
  } } });
  assert.equal(data(await call(client, 'drive_upload_file', { name: 'example.js', mimeType: 'text/javascript', base64Content: Buffer.from('console.log(1)').toString('base64') })).id, 'file-id');
  assert.equal(uploaded, 'console.log(1)');
});

test('API error details are redacted and writes are not retried', async t => {
  let writes = 0;
  const client = await connected(t, { courses: { courseWorkMaterials: { create: async () => { writes++; throw Object.assign(new Error('secret-token'), { response: { status: 503, data: 'private' } }); } } } });
  const result = await call(client, 'classroom_create_material', { courseId: 'test', title: 'x' });
  assert.equal(result.isError, true);
  assert(!JSON.stringify(result).includes('secret-token'));
  assert.match(result.content[0].text, /Verify the target before retrying/);
  assert.equal(writes, 1);
});
