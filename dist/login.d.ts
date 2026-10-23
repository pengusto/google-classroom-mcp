import type { google } from 'googleapis';
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
/** Desktop-only browser login. Token verification and persistence stay with the caller. */
export declare function authorizeDesktop(auth: OAuth2Client, scopes: string[], options?: {
    openBrowser?: (url: string) => Promise<unknown>;
    timeoutMs?: number;
}): Promise<OAuth2Client>;
export {};
//# sourceMappingURL=login.d.ts.map