import { google } from 'googleapis';
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
type Credentials = OAuth2Client['credentials'];
import 'dotenv/config';
export declare const credentialsPath: string;
export declare const tokenPath: string;
export declare const scopes: string[];
export declare function hasRequiredScopes(token: Credentials): boolean;
export declare function saveToken(token: Credentials, destination?: string): void;
export declare function createAuthClient(): OAuth2Client;
export declare function loadAuthClient(): OAuth2Client;
export {};
//# sourceMappingURL=auth.d.ts.map