#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { google, classroom_v1, drive_v3, slides_v1 } from 'googleapis';
import { loadAuthClient } from './auth.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { Readable } from 'stream';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

const __filename = fileURLToPath(import.meta.url);


export class GoogleClassroomServer {
  private server: Server;
  private classroom?: classroom_v1.Classroom;
  private drive?: drive_v3.Drive;
  private slides?: slides_v1.Slides;

  constructor() {
    this.server = new Server(
      { name: 'google-classroom-mcp', version: '3.0.0-beta.1' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  private async initApis() {
    if (!this.classroom || !this.drive || !this.slides) {
      const auth = loadAuthClient();
      this.classroom = google.classroom({ version: 'v1', auth });
      this.drive = google.drive({ version: 'v3', auth });
      this.slides = google.slides({ version: 'v1', auth });
    }
    return { classroom: this.classroom!, drive: this.drive!, slides: this.slides! };
  }

  private setupHandlers() {
    const tools = this.getTools();
    const validator = new AjvJsonSchemaValidator();
    const validators = new Map(tools.map(tool => [tool.name, validator.getValidator(tool.inputSchema)]));
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
      const name = request.params.name;
      const validate = validators.get(name);
      if (!validate) return fail('Tool is not available.');
      const args = request.params.arguments || {};
      if (!validate(args).valid) return fail('Invalid arguments. Check required fields, types and allowed values in tools/list.');
      if (name === 'classroom_update_course' && Object.keys(args).length === 1) return fail('Supply at least one course field to change.');
      const patch = name.startsWith('classroom_patch_') && args.updateMask;
      if (patch) {
        const fields = String(args.updateMask).split(',');
        if (new Set(fields).size !== fields.length || fields.some(field => args[field] === undefined)) {
          return fail('Each updateMask field must be supplied exactly once. Use an empty string to clear a supported text field.');
        }
      }
      if (args.dueTime && !args.dueDate) return fail('dueTime requires dueDate; both use UTC.');
      if (patch && args.dueTime && !String(args.updateMask).split(',').includes('dueTime')) return fail('Include dueTime in updateMask when supplying it.');
      if (args.scheduledTime && args.state === 'PUBLISHED') return fail('Scheduled posts must be DRAFT.');
      for (const attachment of (args.attachments as any[] || [])) {
        if (['link', 'form'].includes(attachment.type)) {
          try {
            if (!['http:', 'https:'].includes(new URL(attachment.idOrUrl).protocol)) return fail('Attachment links must use HTTP or HTTPS.');
          } catch { return fail('Attachment link is invalid.'); }
        }
      }
      if (name === 'drive_upload_file') {
        const content = args.base64Content as string;
        const buffer = Buffer.from(content, 'base64');
        if (buffer.length > 5 * 1024 * 1024 || buffer.toString('base64') !== content) return fail('File must be canonical base64 and at most 5 MiB.');
      }
      let apis;
      try { apis = await this.initApis(); }
      catch { return fail('OAuth is unavailable. Run npm run auth and check credential/token file paths and permissions.'); }
      try {
        return await this.handleToolCall(apis.classroom, apis.drive, apis.slides, name, args);
      } catch (error: any) {
        const status = Number(error.response?.status || error.code);
        const reason = status === 401 ? 'OAuth expired; run npm run auth.'
          : status === 403 ? 'Access denied. Check scopes, course role and the Google project that created the post.'
          : status === 404 ? 'Resource not found or inaccessible.'
          : status === 400 ? 'Google rejected these arguments or this state change.'
          : status === 429 ? 'Google rate limit reached.' : 'Google request failed.';
        const readOnly = /_(list|get|search)_/.test(name);
        return fail(reason + (readOnly ? '' : ' Verify the target before retrying; the write may have succeeded.'));
      }
    });
  }

  // ─── HELPER: map attachment descriptors to Classroom API material format ───
  private mapAttachments(attachments: any[]) {
    return attachments.map(att => {
      switch (att.type) {
        case 'driveFile':     return { driveFile: { driveFile: { id: att.idOrUrl } } };
        case 'link':          return { link: { url: att.idOrUrl } };
        case 'youtubeVideo':  return { youtubeVideo: { id: att.idOrUrl } };
        case 'form':          return { form: { formUrl: att.idOrUrl } };
        default:              return att;
      }
    });
  }

  // ─── HELPER: parse "YYYY-MM-DD" and optional "HH:MM" into API date/time ───
  private parseDueDateTime(dueDate?: string, dueTime?: string) {
    if (!dueDate) return {};
    const [year, month, day] = dueDate.split('-').map(Number);
    const [hours, minutes] = (dueTime || '23:59').split(':').map(Number);
    return {
      dueDate: { year, month, day },
      dueTime: { hours, minutes, seconds: 0, nanos: 0 },
    };
  }

  // ─── TOOLS DECLARATION ────────────────────────────────────────────────────
  private getTools(): Tool[] {
    const tools: Tool[] = [

      {
        name: 'slides_get_presentation',
        description: 'Read a Google Slides presentation by ID, including its slide text and structure.',
        inputSchema: {
          type: 'object',
          properties: { presentationId: { type: 'string', description: 'Google Slides presentation ID' } },
          required: ['presentationId'],
        },
      },

      // ── COURSES ──────────────────────────────────────────────────────────
      {
        name: 'classroom_list_courses',
        description: 'List all Google Classroom courses. Supports filtering by state (ACTIVE, ARCHIVED, PROVISIONED).',
        inputSchema: {
          type: 'object',
          properties: {
            courseStates: { type: 'array', items: { type: 'string' }, description: 'ACTIVE, ARCHIVED, PROVISIONED' },
            pageSize: { type: 'number', default: 50 },
            pageToken: { type: 'string' },
            fullData: { type: 'boolean', default: false, description: 'If true, return all fields (may be very large)' },
          },
        },
      },
      {
        name: 'classroom_search_courses',
        description: 'Search courses by name or section (client-side filter, case-insensitive).',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'String to search for in course name or section' },
          },
          required: ['query'],
        },
      },
      {
        name: 'classroom_get_course',
        description: 'Get full details of a specific course by ID.',
        inputSchema: {
          type: 'object',
          properties: { courseId: { type: 'string' } },
          required: ['courseId'],
        },
      },
      {
        name: 'classroom_update_course',
        description: 'Update course fields (name, section, description, room, state). State can be ACTIVE or ARCHIVED.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            name: { type: 'string' },
            section: { type: 'string' },
            description: { type: 'string' },
            room: { type: 'string' },
            state: { type: 'string', enum: ['ACTIVE', 'ARCHIVED', 'PROVISIONED', 'DECLINED'] },
          },
          required: ['courseId'],
        },
      },

      // ── COURSEWORK (ASSIGNMENTS / QUESTIONS) ─────────────────────────────
      {
        name: 'classroom_get_assignment',
        description: 'Get full details of a specific assignment by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            id: { type: 'string', description: 'Assignment (courseWork) ID' },
          },
          required: ['courseId', 'id'],
        },
      },
      {
        name: 'classroom_list_assignments',
        description: 'List coursework (assignments/questions) for a course. Supports filtering by state.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            courseWorkStates: { type: 'array', items: { type: 'string' }, description: 'PUBLISHED, DRAFT, DELETED' },
            pageSize: { type: 'number', default: 50 },
            pageToken: { type: 'string' },
          },
          required: ['courseId'],
        },
      },
      {
        name: 'classroom_create_assignment',
        description: 'Create an assignment or question with optional attachments, due date, and topic.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            workType: { type: 'string', enum: ['ASSIGNMENT', 'SHORT_ANSWER_QUESTION'], default: 'ASSIGNMENT' },
            state: { type: 'string', enum: ['PUBLISHED', 'DRAFT'], default: 'DRAFT' },
            scheduledTime: { type: 'string', description: 'RFC 3339 timestamp for scheduled publication' },
            maxPoints: { type: 'number' },
            dueDate: { type: 'string', description: 'YYYY-MM-DD in UTC' },
            dueTime: { type: 'string', description: 'HH:MM in UTC (defaults to 23:59 if dueDate is set)' },
            topicId: { type: 'string' },
            attachments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['driveFile', 'link', 'youtubeVideo', 'form'] },
                  idOrUrl: { type: 'string' },
                },
              },
            },
          },
          required: ['courseId', 'title'],
        },
      },
      {
        name: 'classroom_patch_assignment',
        description: 'Update specific fields of an existing assignment using updateMask.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            id: { type: 'string', description: 'Assignment ID' },
            updateMask: { type: 'string', description: 'Comma-separated fields: title,description,dueDate,dueTime,maxPoints,topicId,state' },
            title: { type: 'string' },
            description: { type: 'string' },
            maxPoints: { type: 'number' },
            topicId: { type: 'string' },
            dueDate: { type: 'string', description: 'YYYY-MM-DD in UTC' },
            dueTime: { type: 'string', description: 'HH:MM in UTC; requires dueDate' },
            scheduledTime: { type: 'string', description: 'RFC 3339 timestamp for scheduled publication' },
            state: { type: 'string', enum: ['PUBLISHED', 'DRAFT'] },
          },
          required: ['courseId', 'id', 'updateMask'],
        },
      },

      // ── TOPICS ────────────────────────────────────────────────────────────
      {
        name: 'classroom_get_topic',
        description: 'Get details of a specific topic by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            id: { type: 'string', description: 'Topic ID' },
          },
          required: ['courseId', 'id'],
        },
      },
      {
        name: 'classroom_list_topics',
        description: 'List all topics in a course.',
        inputSchema: {
          type: 'object',
          properties: { courseId: { type: 'string' } },
          required: ['courseId'],
        },
      },
      {
        name: 'classroom_create_topic',
        description: 'Create a new topic/unit in a course.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['courseId', 'name'],
        },
      },
      {
        name: 'classroom_patch_topic',
        description: 'Rename or update a topic.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            id: { type: 'string', description: 'Topic ID' },
            name: { type: 'string' },
          },
          required: ['courseId', 'id', 'name'],
        },
      },

      // ── MATERIALS ─────────────────────────────────────────────────────────
      {
        name: 'classroom_get_material',
        description: 'Get full details of a specific course material by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            id: { type: 'string', description: 'Material ID' },
          },
          required: ['courseId', 'id'],
        },
      },
      {
        name: 'classroom_list_materials',
        description: 'List all non-graded materials for a course.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            pageSize: { type: 'number', default: 50 },
            courseWorkMaterialStates: { type: 'array', items: { type: 'string' }, description: 'PUBLISHED oder DRAFT' },
          },
          required: ['courseId'],
        },
      },
      {
        name: 'classroom_create_material',
        description: 'Create a study material post with optional attachments and topic.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            state: { type: 'string', enum: ['PUBLISHED', 'DRAFT'], default: 'DRAFT' },
            title: { type: 'string' },
            description: { type: 'string' },
            topicId: { type: 'string' },
            scheduledTime: { type: 'string', description: 'RFC 3339 timestamp for scheduled publication' },
            attachments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['driveFile', 'link', 'youtubeVideo', 'form'] },
                  idOrUrl: { type: 'string' },
                },
              },
            },
          },
          required: ['courseId', 'title'],
        },
      },
      {
        name: 'classroom_patch_material',
        description: 'Update fields of an existing material post.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            id: { type: 'string' },
            updateMask: { type: 'string', description: 'Comma-separated: title,description,state,topicId' },
            title: { type: 'string' },
            description: { type: 'string' },
            topicId: { type: 'string' },
            scheduledTime: { type: 'string', description: 'RFC 3339 timestamp for scheduled publication' },
            state: { type: 'string', enum: ['PUBLISHED', 'DRAFT'] },
          },
          required: ['courseId', 'id', 'updateMask'],
        },
      },

      // ── ANNOUNCEMENTS ─────────────────────────────────────────────────────
      {
        name: 'classroom_list_announcements',
        description: 'List announcements for a course.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            announcementStates: { type: 'array', items: { type: 'string', enum: ['PUBLISHED', 'DRAFT', 'DELETED'] } },
            pageSize: { type: 'number', default: 50 },
          },
          required: ['courseId'],
        },
      },
      {
        name: 'classroom_post_announcement',
        description: 'Post an announcement to the course stream.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            text: { type: 'string' },
            state: { type: 'string', enum: ['PUBLISHED', 'DRAFT'], default: 'DRAFT' },
            scheduledTime: { type: 'string', description: 'RFC 3339 timestamp for scheduled publication' },
          },
          required: ['courseId', 'text'],
        },
      },
      {
        name: 'classroom_patch_announcement',
        description: 'Edit an existing announcement.',
        inputSchema: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            id: { type: 'string' },
            text: { type: 'string' },
            state: { type: 'string', enum: ['PUBLISHED', 'DRAFT'] },
            scheduledTime: { type: 'string' },
            updateMask: { type: 'string' },
          },
          required: ['courseId', 'id', 'updateMask'],
        },
      },

      // ── DRIVE & ATTACHMENTS ───────────────────────────────────────────────
      {
        name: 'drive_upload_file',
        description: 'Upload a base64-encoded file to Google Drive. Returns the Drive file ID and URL.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            mimeType: { type: 'string', maxLength: 127, pattern: '^[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+$', default: 'application/octet-stream' },
            base64Content: { type: 'string', maxLength: 6990508, pattern: '^[A-Za-z0-9+/=]+$' },
          },
          required: ['name', 'base64Content'],
        },
      },
    ];

    for (const tool of tools) {
      const properties = tool.inputSchema.properties as Record<string, any>;
      tool.inputSchema.additionalProperties = false;
      tool.annotations = { readOnlyHint: /_(list|get|search)_/.test(tool.name), openWorldHint: true };
      if (tool.name.includes('_list_') || tool.name === 'classroom_search_courses') {
        properties.pageToken = { type: 'string', minLength: 1 };
        properties.pageSize = { type: 'integer', minimum: 1, maximum: 100, default: 50 };
        properties.fullData = { type: 'boolean', default: false };
        tool.description += ' Returns one page as {items, nextPageToken}; continue until nextPageToken is null.';
      }
      for (const [name, property] of Object.entries(properties)) {
        if (property.type === 'string' && !['description', 'section', 'room', 'topicId'].includes(name)) property.minLength = 1;
        if (name === 'scheduledTime') {
          property.format = 'date-time';
          if (tool.name.startsWith('classroom_patch_')) {
            property.type = ['string', 'null'];
            property.description = 'RFC 3339 timestamp, or null to cancel scheduled publication.';
          }
        }
        if (name === 'dueDate') property.format = 'date';
        if (name === 'dueTime') property.pattern = '^([01][0-9]|2[0-3]):[0-5][0-9]$';
        if (name === 'maxPoints') property.minimum = 0;
        if (name.endsWith('States')) property.items.enum = name === 'courseStates'
          ? ['ACTIVE', 'ARCHIVED', 'PROVISIONED', 'DECLINED', 'SUSPENDED'] : ['PUBLISHED', 'DRAFT', 'DELETED'];
        if (name === 'attachments') {
          property.maxItems = 20;
          property.items.required = ['type', 'idOrUrl'];
          property.items.additionalProperties = false;
          property.items.properties.idOrUrl.minLength = 1;
        }
      }
      if (properties.updateMask) {
        const fields = Object.keys(properties).filter(key => !['courseId', 'id', 'updateMask'].includes(key));
        properties.updateMask.pattern = `^(${fields.join('|')})(,(${fields.join('|')}))*$`;
        properties.updateMask.description = `Comma-separated supplied fields: ${fields.join(',')}`;
      }
    }
    return tools;
  }

  // ─── TOOL DISPATCH ────────────────────────────────────────────────────────
  private async handleToolCall(
    classroom: classroom_v1.Classroom,
    drive: drive_v3.Drive,
    slides: slides_v1.Slides,
    name: string,
    args: any
  ) {
    const ok = (data: any) => ({
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    });

    switch (name) {

      case 'slides_get_presentation': {
        const r = await slides.presentations.get({ presentationId: args.presentationId });
        return ok(r.data);
      }

      // ── COURSES ────────────────────────────────────────────────────────
      case 'classroom_list_courses': {
        const r = await classroom.courses.list({
          courseStates: args.courseStates,
          pageSize: args.pageSize ?? 50,
          pageToken: args.pageToken,
          fields: args.fullData
            ? undefined
            : 'courses(id,name,section,courseState,enrollmentCode,alternateLink,ownerId,updateTime),nextPageToken',
        });
        return ok({ items: r.data.courses ?? [], nextPageToken: r.data.nextPageToken ?? null });
      }

      case 'classroom_search_courses': {
        const r = await classroom.courses.list({ pageSize: args.pageSize ?? 50, pageToken: args.pageToken, fields: args.fullData ? undefined : 'courses(id,name,section,courseState),nextPageToken' });
        const q = args.query.toLowerCase();
        const filtered = (r.data.courses ?? []).filter(c =>
          c.name?.toLowerCase().includes(q) ||
          c.section?.toLowerCase().includes(q)
        );
        return ok({ items: filtered, nextPageToken: r.data.nextPageToken ?? null });
      }

      case 'classroom_get_course': {
        const r = await classroom.courses.get({ id: args.courseId });
        return ok(r.data);
      }

      case 'classroom_update_course': {
        const body: any = {};
        const maskFields: string[] = [];
        if (args.name !== undefined)        { body.name = args.name;               maskFields.push('name'); }
        if (args.section !== undefined)     { body.section = args.section;         maskFields.push('section'); }
        if (args.description !== undefined) { body.descriptionHeading = args.description; maskFields.push('descriptionHeading'); }
        if (args.room !== undefined)        { body.room = args.room;               maskFields.push('room'); }
        if (args.state !== undefined)       { body.courseState = args.state;       maskFields.push('courseState'); }
        const r = await classroom.courses.patch({
          id: args.courseId,
          updateMask: maskFields.join(','),
          requestBody: body,
        });
        return ok(r.data);
      }

      // ── COURSEWORK ─────────────────────────────────────────────────────
      case 'classroom_get_assignment': {
        const r = await classroom.courses.courseWork.get({
          courseId: args.courseId,
          id: args.id,
        });
        return ok(r.data);
      }

      case 'classroom_list_assignments': {
        const r = await classroom.courses.courseWork.list({
          courseId: args.courseId,
          courseWorkStates: args.courseWorkStates ?? ['PUBLISHED', 'DRAFT'],
          pageSize: args.pageSize ?? 50,
          pageToken: args.pageToken,
          fields: args.fullData
            ? undefined
            : 'courseWork(id,title,workType,state,maxPoints,dueDate,dueTime,scheduledTime,topicId,creationTime,updateTime),nextPageToken',
        });
        return ok({ items: r.data.courseWork ?? [], nextPageToken: r.data.nextPageToken ?? null });
      }

      case 'classroom_create_assignment': {
        const body: any = {
          title: args.title,
          description: args.description,
          workType: args.workType ?? 'ASSIGNMENT',
          state: args.scheduledTime ? 'DRAFT' : (args.state ?? 'DRAFT'),
          scheduledTime: args.scheduledTime,
          maxPoints: args.maxPoints,
          topicId: args.topicId,
          ...this.parseDueDateTime(args.dueDate, args.dueTime),
        };
        if (args.attachments?.length) {
          body.materials = this.mapAttachments(args.attachments);
        }
        const r = await classroom.courses.courseWork.create({
          courseId: args.courseId,
          requestBody: body,
        });
        return ok(r.data);
      }

      case 'classroom_patch_assignment': {
        const body: any = {};
        if (args.title !== undefined)       body.title = args.title;
        if (args.description !== undefined) body.description = args.description;
        if (args.maxPoints !== undefined)   body.maxPoints = args.maxPoints;
        if (args.topicId !== undefined)     body.topicId = args.topicId;
        if (args.state !== undefined)       body.state = args.state;
        if (args.scheduledTime != null) body.scheduledTime = args.scheduledTime;
        if (args.dueDate) {
          Object.assign(body, this.parseDueDateTime(args.dueDate, args.dueTime));
        }
        const r = await classroom.courses.courseWork.patch({
          courseId: args.courseId,
          id: args.id,
          updateMask: args.updateMask,
          requestBody: body,
        });
        return ok(r.data);
      }

      // ── TOPICS ─────────────────────────────────────────────────────────
      case 'classroom_get_topic': {
        const r = await classroom.courses.topics.get({
          courseId: args.courseId,
          id: args.id,
        });
        return ok(r.data);
      }

      case 'classroom_list_topics': {
        const r = await classroom.courses.topics.list({ courseId: args.courseId, pageToken: args.pageToken, pageSize: args.pageSize ?? 50 });
        return ok({ items: r.data.topic ?? [], nextPageToken: r.data.nextPageToken ?? null });
      }

      case 'classroom_create_topic': {
        const r = await classroom.courses.topics.create({
          courseId: args.courseId,
          requestBody: { name: args.name },
        });
        return ok(r.data);
      }

      case 'classroom_patch_topic': {
        const r = await classroom.courses.topics.patch({
          courseId: args.courseId,
          id: args.id,
          updateMask: 'name',
          requestBody: { name: args.name },
        });
        return ok(r.data);
      }

      // ── MATERIALS ──────────────────────────────────────────────────────
      case 'classroom_get_material': {
        const r = await classroom.courses.courseWorkMaterials.get({
          courseId: args.courseId,
          id: args.id,
        });
        return ok(r.data);
      }

      case 'classroom_list_materials': {
        const r = await classroom.courses.courseWorkMaterials.list({
          courseId: args.courseId,
          courseWorkMaterialStates: args.courseWorkMaterialStates ?? ['PUBLISHED', 'DRAFT'],
          pageToken: args.pageToken,
          pageSize: args.pageSize ?? 50,
          fields: args.fullData
            ? undefined
            : 'courseWorkMaterial(id,title,description,topicId,state,scheduledTime,creationTime,updateTime),nextPageToken',
        });
        return ok({ items: r.data.courseWorkMaterial ?? [], nextPageToken: r.data.nextPageToken ?? null });
      }

      case 'classroom_create_material': {
        const body: any = {
          title: args.title,
          description: args.description,
          topicId: args.topicId,
          state: args.scheduledTime ? 'DRAFT' : (args.state ?? 'DRAFT'),
          scheduledTime: args.scheduledTime,
        };
        if (args.attachments?.length) {
          body.materials = this.mapAttachments(args.attachments);
        }
        const r = await classroom.courses.courseWorkMaterials.create({
          courseId: args.courseId,
          requestBody: body,
        });
        return ok(r.data);
      }

      case 'classroom_patch_material': {
        const body: any = {};
        if (args.title !== undefined)       body.title = args.title;
        if (args.description !== undefined) body.description = args.description;
        if (args.topicId !== undefined)     body.topicId = args.topicId;
        if (args.state !== undefined)       body.state = args.state;
        if (args.scheduledTime != null) body.scheduledTime = args.scheduledTime;
        const r = await classroom.courses.courseWorkMaterials.patch({
          courseId: args.courseId,
          id: args.id,
          updateMask: args.updateMask,
          requestBody: body,
        });
        return ok(r.data);
      }

      // ── ANNOUNCEMENTS ──────────────────────────────────────────────────
      case 'classroom_list_announcements': {
        const r = await classroom.courses.announcements.list({
          courseId: args.courseId,
          pageToken: args.pageToken,
          announcementStates: args.announcementStates ?? ['PUBLISHED', 'DRAFT'],
          pageSize: args.pageSize ?? 50,
          fields: args.fullData
            ? undefined
            : 'announcements(id,text,state,scheduledTime,creationTime,updateTime),nextPageToken',
        });
        return ok({ items: r.data.announcements ?? [], nextPageToken: r.data.nextPageToken ?? null });
      }

      case 'classroom_post_announcement': {
        const r = await classroom.courses.announcements.create({
          courseId: args.courseId,
          requestBody: {
            text: args.text,
            state: args.scheduledTime ? 'DRAFT' : (args.state ?? 'DRAFT'),
            scheduledTime: args.scheduledTime,
          },
        });
        return ok(r.data);
      }

      case 'classroom_patch_announcement': {
        const r = await classroom.courses.announcements.patch({
          courseId: args.courseId,
          id: args.id,
          updateMask: args.updateMask,
          requestBody: { text: args.text, state: args.state, scheduledTime: args.scheduledTime ?? undefined },
        });
        return ok(r.data);
      }

      // ── DRIVE & ATTACHMENTS ────────────────────────────────────────────
      case 'drive_upload_file': {
        const buffer = Buffer.from(args.base64Content, 'base64');
        const mimeType = args.mimeType ?? 'application/octet-stream';
        const r = await drive.files.create({
          requestBody: { name: args.name, mimeType },
          media: { mimeType, body: Readable.from(buffer) },
          fields: 'id,name,webViewLink',
        });
        return ok(r.data);
      }

      default:
        throw new Error(`Tool not implemented: ${name}`);
    }
  }

  async run(transport: Transport = new StdioServerTransport()) {
    await this.server.connect(transport);
    console.error('Google Classroom MCP ready.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  new GoogleClassroomServer().run().catch(() => {
    console.error('MCP startup failed.');
    process.exitCode = 1;
  });
}
