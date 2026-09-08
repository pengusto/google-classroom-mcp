#!/usr/bin/env node
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
export declare class GoogleClassroomServer {
    private server;
    private classroom?;
    private drive?;
    private slides?;
    constructor();
    private initApis;
    private setupHandlers;
    private mapAttachments;
    private parseDueDateTime;
    private getTools;
    private handleToolCall;
    run(transport?: Transport): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map