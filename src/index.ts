import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Import necessary types from @cloudflare/workers-types
// We specifically do NOT import 'DurableObject' as a class to extend.
import { DurableObjectState, ExecutionContext, Request, Response } from '@cloudflare/workers-types';

// Declare global types for Env, DurableObjectNamespace, etc.,
// to make TypeScript aware of these types and your specific binding.
// This is crucial for type checking in your worker's fetch function.
declare global {
    interface Env {
        // This name 'MCP_OBJECT' must match the 'name' field in your wrangler.jsonc Durable Object binding.
        MCP_OBJECT: DurableObjectNamespace;
    }
    // These interfaces are generally provided by @cloudflare/workers-types,
    // but explicit declaration can help if you run into type issues or for clarity.
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


// Define your MyMCP class. It does NOT extend a specific 'DurableObject' class.
// Its behavior as a Durable Object is defined by its constructor signature and fetch method,
// in conjunction with the wrangler.jsonc configuration.
export class MyMCP {
    server: McpServer;
    private state: DurableObjectState; // Holds the Durable Object state (for storage, etc.)
    // private env: Env; // You might store env if needed for other Durable Object interactions

    // The constructor signature is crucial for Durable Objects.
    // It must accept DurableObjectState as the first argument, and Env as the second.
    constructor(state: DurableObjectState, env: Env) {
        this.state = state; // Store the state object
        // this.env = env; // Store env if your DO needs to interact with other bindings

        // Initialize McpServer instance. This will be the single server instance for this DO.
        this.server = new McpServer({
            name: "Auth Calculator", // Descriptive name
            version: "1.0.0",
        });

        // Initialize tools immediately upon construction of the Durable Object.
        this.init();
    }

    async init() {
        // Simple addition tool
        this.server.tool(
            "add",
            { a: z.number(), b: z.number() },
            // The context object (third argument) will carry our authToken
            async ({ a, b }, context: { authToken?: string }) => {
                console.log("Auth Token in 'add' tool:", context.authToken);
                // Implement your authentication/authorization logic here using context.authToken
                return {
                    content: [{ type: "text", text: String(a + b) }],
                };
            }
        );

        // Calculator tool with multiple operations
        this.server.tool(
            "calculate",
            {
                operation: z.enum(["add", "subtract", "multiply", "divide"]),
                a: z.number(),
                b: z.number(),
            },
            // The context object (third argument) will carry our authToken
            async ({ operation, a, b }, context: { authToken?: string }) => {
                console.log("Auth Token in 'calculate' tool:", context.authToken);
                // Implement your authentication/authorization logic here using context.authToken

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
                }
                return { content: [{ type: "text", text: String(result) }] };
            }
        );
    }

    // The fetch method is the entry point for requests routed to this Durable Object instance.
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // 1. Extract the Auth Token from the incoming request.
        let authToken: string | undefined;
        const authHeader = request.headers.get("Authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
            authToken = authHeader.slice(7); // Extract the token after "Bearer "
        }

        // 2. Create a context object to pass to the MCP server's fetch method.
        // This allows your tools to access the request-specific authToken.
        const context = { authToken };

        // Route requests based on pathname to MCP server's SSE or standard endpoint.
        if (url.pathname === "/sse" || url.pathname === "/sse/message") {
            // MCP SDK's serveSSE.fetch method takes request, DurableObjectState, and an optional context.
            // The 'as any' is a workaround if the MCP SDK's types aren't perfectly aligned,
            // but it's generally safe for passing an additional context object.
            return this.server.serveSSE("/sse").fetch(request, this.state, context as any);
        }

        if (url.pathname === "/mcp") {
            // MCP SDK's serve.fetch method takes request, DurableObjectState, and an optional context.
            return this.server.serve("/mcp").fetch(request, this.state, context as any);
        }

        // Handle unknown paths within the Durable Object
        return new Response("Not found within Durable Object", { status: 404 });
    }
}


// This is the main Worker entry point. It handles routing requests to your Durable Object.
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        let id: DurableObjectId;
        let stub: DurableObjectStub;

        // Only route requests intended for the MCP server or SSE to the Durable Object.
        // All other requests will be handled by the worker itself or return 404.
        if (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/sse")) {
            // Get a Durable Object ID.
            // For a single, long-lived instance, use idFromName with a fixed name.
            id = env.MCP_OBJECT.idFromName("MySingleMCPInstance");

            // Get a stub to the Durable Object instance.
            stub = env.MCP_OBJECT.get(id);

            // Forward the incoming request directly to the Durable Object instance.
            // The Durable Object's 'fetch' method will then process it.
            return stub.fetch(request);
        }

        // If the path doesn't match, return a Not Found response from the worker itself.
        return new Response("Not found in Worker entry point", { status: 404 });
    },
};
