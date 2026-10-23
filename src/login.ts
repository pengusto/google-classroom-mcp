import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import open from 'open';
import type { google } from 'googleapis';

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

/** Desktop-only browser login. Token verification and persistence stay with the caller. */
export async function authorizeDesktop(
  auth: OAuth2Client,
  scopes: string[],
  options: { openBrowser?: (url: string) => Promise<unknown>; timeoutMs?: number } = {},
): Promise<OAuth2Client> {
  const state = randomBytes(32).toString('base64url');
  const { codeVerifier, codeChallenge } = await auth.generateCodeVerifierAsync();
  const openBrowser = options.openBrowser ?? (async (url: string) => {
    const child = await open(url, { wait: false });
    child.unref();
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let exchanging = false;
    let redirect: URL;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
      if (error) reject(error);
      else resolve(auth);
    };
    const server = createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      let callback: URL;
      try { callback = new URL(req.url || '/', redirect); }
      catch { res.writeHead(400).end('Invalid callback URL.'); return; }
      if (req.method !== 'GET' || req.headers.host !== redirect.host || callback.origin !== redirect.origin || callback.pathname !== redirect.pathname) {
        res.writeHead(404).end('Not found.');
        return;
      }
      const received = Buffer.from(callback.searchParams.get('state') || '');
      const expected = Buffer.from(state);
      if (callback.searchParams.getAll('state').length !== 1 || received.length !== expected.length || !timingSafeEqual(received, expected)) {
        res.writeHead(403).end('Invalid authorization state.');
        return;
      }
      if (exchanging || settled) {
        res.writeHead(409).end('Authorization is already being handled.');
        return;
      }
      if (callback.searchParams.has('error')) {
        res.end('Authorization was declined. Return to the terminal.', () => finish(new Error('Desktop authorization was declined.')));
        return;
      }
      const code = callback.searchParams.get('code');
      if (!code || callback.searchParams.getAll('code').length !== 1) {
        res.writeHead(400).end('One authorization code is required.');
        return;
      }
      exchanging = true;
      try {
        const { tokens } = await auth.getToken({ code, codeVerifier, redirect_uri: redirect.toString() });
        if (settled) return;
        auth.setCredentials(tokens);
        res.end('Authorization received. Return to the terminal for verification.', () => finish());
      } catch {
        if (settled) return;
        res.writeHead(502).end('Authorization failed. Return to the terminal.', () => finish(new Error('Desktop token exchange failed.')));
      }
    });
    const timer = setTimeout(() => finish(new Error('Desktop authorization timed out.')), options.timeoutMs ?? 300_000);
    server.once('error', () => finish(new Error('Could not start the local authorization callback.')));
    server.listen(0, '127.0.0.1', () => {
      if (settled) return;
      const address = server.address();
      if (!address || typeof address === 'string') return finish(new Error('Local authorization callback is unavailable.'));
      redirect = new URL(`http://127.0.0.1:${address.port}/oauth2callback`);
      const url = new URL(auth.generateAuthUrl({ access_type: 'offline', scope: scopes, state, redirect_uri: redirect.toString() }));
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('code_challenge', codeChallenge!);
      Promise.resolve().then(() => openBrowser(url.toString())).catch(() => finish(new Error('Could not open the authorization browser.')));
    });
  });
}
