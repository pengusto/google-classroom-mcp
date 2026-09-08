#!/usr/bin/env node
import fs from 'node:fs';
import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';
import { credentialsPath, tokenPath, scopes, hasRequiredScopes, saveToken, loadAuthClient } from './dist/auth.js';

async function authorize() {
  if (process.argv.includes('--check')) {
    const auth = loadAuthClient();
    await google.classroom({ version: 'v1', auth }).courses.list({ pageSize: 1, fields: 'courses(id)' });
    console.log('Classroom API: OK');
    await google.drive({ version: 'v3', auth }).files.list({ pageSize: 1, fields: 'files(id)' });
    console.log('Drive API: OK');
    console.log('OAuth files and required scopes: OK. No course content was changed.');
    console.log('Slides API and participant file access require a presentation and participant check.');
    return;
  }
  if (fs.existsSync(tokenPath)) {
    const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    if (hasRequiredScopes(token)) {
      try {
        await google.classroom({ version: 'v1', auth: loadAuthClient() }).courses.list({ pageSize: 1 });
        console.log('OAuth connection verified.');
        return;
      } catch (error) {
        if (error.response?.status !== 401 && error.response?.data?.error !== 'invalid_grant') throw error;
      }
    }
  }
  const auth = await authenticate({ scopes, keyfilePath: credentialsPath });
  if (!hasRequiredScopes(auth.credentials)) throw new Error('Required access was not granted.');
  await google.classroom({ version: 'v1', auth }).courses.list({ pageSize: 1 });
  saveToken(auth.credentials);
  console.log('OAuth connection verified; token saved locally.');
}

authorize().catch(error => {
  const status = Number(error.response?.status);
  const reasons = (error.response?.data?.error?.errors || []).map(item => item.reason);
  const message = error.code === 'ENOENT' ? 'OAuth file missing. Check GOOGLE_CREDENTIALS_PATH and GOOGLE_TOKEN_PATH; run npm run auth for a missing token.'
    : ['EACCES', 'EPERM'].includes(error.code) ? 'OAuth file permission denied. Check access to credential/token files and their parent directory.'
    : error instanceof SyntaxError ? 'OAuth file is not valid JSON. Download Desktop credentials again or reauthorize; do not paste secrets into an issue.'
    : error.message === 'Required OAuth scopes are missing.' ? 'Required scopes are missing. Run npm run auth and grant the listed access.'
    : error.message === 'Desktop OAuth credentials are required.' ? 'Use a Desktop app OAuth client, not Web application credentials.'
    : reasons.includes('accessNotConfigured') || reasons.includes('serviceDisabled') ? 'Enable the requested Classroom or Drive API in the Google Cloud project belonging to your OAuth client.'
    : status === 401 || error.response?.data?.error === 'invalid_grant' ? 'OAuth grant expired or revoked. Run npm run auth to reconnect.'
    : status === 403 ? 'Google denied access. Check enabled APIs, granted scopes, consent test-user access and Workspace administrator policy.'
    : 'Connection check failed. Check network access and Google Cloud configuration; existing tokens were preserved.';
  console.error(message);
  process.exitCode = 1;
});
