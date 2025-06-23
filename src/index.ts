import { McpAgent } from "agents/mcp"; // Keep McpAgent if you need its specific methods, otherwise just McpServer
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Import DurableObjectState explicitly.
import { DurableObjectState } from '@cloudflare/workers-types';

// Declare global types as before for Env and Durable Object related interfaces.
declare global {
    interface Env {
        MCP_OBJECT: DurableObjectNamespace;
    }
    interface DurableObjectNamespace {
        idFromName(name: string): DurableObjectId;
        get(id: DurableObjectId): DurableObjectStub;
        newUniqueId(): DurableObjectId;
    }
    interface DurableObjectId {}
    interface DurableObjectStub {
        fetch(request: Request): Promise<Response>;
    }
}


// MyMCP will no longer extend McpAgent directly.
// Instead, it will create and manage an instance of McpServer.
export class MyMCP {
    // This is the correct name for the McpServer instance
    private mcpServer: McpServer;
    private state: DurableObjectState;
    // private env: Env; // Uncomment if your DO needs direct access to env bindings

    // The constructor for a Durable Object MUST have DurableObjectState as its first parameter,
    // followed by the environment (Env).
    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        // this.env = env; // Store env if needed

        // Initialize the McpServer instance here.
        this.mcpServer = new McpServer({
            name: "Auth Calculator",
            version: "1.0.0",
        });

        // Register the tools with the internal mcpServer instance.
        this.initTools();
    }

    async initTools() {
        // Simple addition tool
        this.mcpServer.tool( // *** CORRECTED: Use this.mcpServer ***
            "add",
            { a: z.number(), b: z.number() },
            async ({ a, b }, context: { authToken?: string }) => {
                console.log("Auth Token in 'add' tool:", context.authToken);
                return {
                    content: [{ type: "text", text: String(a + b) }],
                };
            }
        );

        // Calculator tool with multiple operations
        this.mcpServer.tool( // *** CORRECTED: Use this.mcpServer ***
            "calculate",
            {
                operation: z.enum(["add", "subtract", "multiply", "divide"]),
                a: z.number(),
                b: z.number(),
            },
            async ({ operation, a, b }, context: { authToken?: string }) => {
                console.log("Auth Token in 'calculate' tool:", context.authToken);

                let result: number;
                switch (operation) {
                    case "add":
                        result = a + b;
                        break;
                    case "subtract":
                        result = a - b;
                        break;
                    case "multiply":
                        result = a * b;
                        break;
                    case "divide":
                        if (b === 0)
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: "Error: Cannot divide by zero",
                                    },
                                ],
                            };
                        result = a / b;
                        break;
                    default:
                        return { content: [{ type: "text", text: "Error: Unknown operation" }] };
                }
                return { content: [{ type: "text", text: String(result) }] };
            }
        );
    }

    // The fetch method of the Durable Object
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        let authToken: string | undefined;
        const authHeader = request.headers.get("Authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
            authToken = authHeader.slice(7);
        }

        const context = { authToken };

        // Route requests using the internal mcpServer instance
        if (url.pathname === "/sse" || url.pathname === "/sse/message") {
            // *** CORRECTED: Use this.mcpServer ***
            return this.mcpServer.serveSSE("/sse").fetch(request, this.state, context as any);
        }

        if (url.pathname === "/mcp") {
            // *** CORRECTED: Use this.mcpServer ***
            return this.mcpServer.serve("/mcp").fetch(request, this.state, context as any);
        }

        return new Response("Not found within Durable Object", { status: 404 });
    }
}


// Main Worker entry point (remains the same)
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        let id: DurableObjectId;
        let stub: DurableObjectStub;

        if (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/sse")) {
            id = env.MCP_OBJECT.idFromName("MySingleMCPInstance");
            stub = env.MCP_OBJECT.get(id);
            return stub.fetch(request);
        }

        return new Response("Not found in Worker entry point", { status: 404 });
    },
};
