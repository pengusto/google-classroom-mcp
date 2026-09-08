import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
type Credentials = OAuth2Client['credentials'];
import 'dotenv/config';

const root = fileURLToPath(new URL('../', import.meta.url));
export const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || path.join(root, 'credentials.json');
export const tokenPath = process.env.GOOGLE_TOKEN_PATH || path.join(root, 'token.json');
export const scopes = [
  'classroom.courses', 'classroom.coursework.students', 'classroom.courseworkmaterials',
  'classroom.topics', 'classroom.announcements', 'drive.file', 'drive.readonly',
].map(scope => `https://www.googleapis.com/auth/${scope}`);

export function hasRequiredScopes(token: Credentials): boolean {
  const granted = new Set((token.scope || '').split(' '));
  return scopes.every(scope => granted.has(scope));
}

export function saveToken(token: Credentials, destination = tokenPath): void {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(token, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function createAuthClient(): OAuth2Client {
  const data = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const config = data.installed;
  if (!config?.client_id || !config.client_secret || !config.redirect_uris?.[0]) {
    throw new Error('Desktop OAuth credentials are required.');
  }
  return new google.auth.OAuth2(config.client_id, config.client_secret, config.redirect_uris[0]);
}

export function loadAuthClient(): OAuth2Client {
  const auth = createAuthClient();
  const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  if (!hasRequiredScopes(token)) throw new Error('Required OAuth scopes are missing.');
  auth.setCredentials(token);
  auth.on('tokens', fresh => {
    // Google may omit refresh_token and scope when refreshing; preserve both.
    Object.assign(token, fresh);
    try { saveToken(token); } catch { console.error('Could not persist refreshed OAuth token. Check token file permissions.'); }
  });
  return auth;
}
