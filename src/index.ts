import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Import DurableObjectState if your setup requires it to be explicitly imported,
// otherwise, it might be globally available. For Request, Response, ExecutionContext,
// and other standard Web APIs, they are generally global and not imported from here.
import { DurableObjectState } from '@cloudflare/workers-types';

// Declare global types for Env and Durable Object related interfaces.
// This helps TypeScript understand the environment bindings and DO structure.
declare global {
    interface Env {
        // This name 'MCP_OBJECT' MUST match the 'name' field in your wrangler.jsonc Durable Object binding.
        MCP_OBJECT: DurableObjectNamespace;
    }
    // These interfaces define the shape of Durable Object related types
    // and are typically part of the global scope provided by the Workers runtime types.
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


// Define your MyMCP class. This class will act as your Durable Object.
// It does NOT explicitly extend a 'DurableObject' base class from @cloudflare/workers-types.
// Its Durable Object nature is determined by its constructor signature and fetch method,
// combined with the configuration in wrangler.jsonc.
export class MyMCP {
    server: McpServer;
    private state: DurableObjectState; // Stores the Durable Object's state (for storage, etc.)
    // private env: Env; // You can uncomment and store env if your DO needs to access other bindings

    // The constructor for a Durable Object must accept DurableObjectState as the first argument,
    // and the Env object as the second (if you need access to environment variables/bindings within the DO).
    constructor(state: DurableObjectState, env: Env) {
        this.state = state; // Assign the provided state object
        // this.env = env; // Assign the provided env object if used

        // Initialize the McpServer instance. This server instance will persist for the life of the DO.
        this.server = new McpServer({
            name: "Auth Calculator", // A descriptive name for your MCP server
            version: "1.0.0",
        });

        // Register the tools with the MCP server immediately upon construction.
        this.init();
    }

    async init() {
        // Define a simple addition tool
        this.server.tool(
            "add",
            { a: z.number(), b: z.number() },
            // The third argument to the tool function is the context, where we'll pass the auth token.
            async ({ a, b }, context: { authToken?: string }) => {
                console.log("Auth Token in 'add' tool:", context.authToken);
                // Integrate your authentication/authorization logic here using context.authToken
                return {
                    content: [{ type: "text", text: String(a + b) }],
                };
            }
        );

        // Define a more complex calculator tool with multiple operations
        this.server.tool(
            "calculate",
            {
                operation: z.enum(["add", "subtract", "multiply", "divide"]),
                a: z.number(),
                b: z.number(),
            },
            // The context object is available here as well.
            async ({ operation, a, b }, context: { authToken?: string }) => {
                console.log("Auth Token in 'calculate' tool:", context.authToken);
                // Integrate your authentication/authorization logic here using context.authToken

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
                        // Add a default case for exhaustive checking, though z.enum handles it
                        return { content: [{ type: "text", text: "Error: Unknown operation" }] };
                }
                return { content: [{ type: "text", text: String(result) }] };
            }
        );
    }

    // The fetch method is the primary entry point for HTTP requests directed to this Durable Object instance.
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // 1. Extract the Authorization token from the request headers.
        let authToken: string | undefined;
        const authHeader = request.headers.get("Authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
            authToken = authHeader.slice(7); // Remove "Bearer " prefix
        }

        // 2. Create a context object containing the extracted authToken.
        // This context will be passed down to your MCP tools.
        const context = { authToken };

        // Route requests based on URL pathname to the appropriate MCP server handler.
        if (url.pathname === "/sse" || url.pathname === "/sse/message") {
            // Serve Server-Sent Events (SSE) requests.
            // The third argument (context as any) passes the auth token to the tool functions.
            return this.server.serveSSE("/sse").fetch(request, this.state, context as any);
        }

        if (url.pathname === "/mcp") {
            // Serve standard MCP requests.
            // The third argument (context as any) passes the auth token to the tool functions.
            return this.server.serve("/mcp").fetch(request, this.state, context as any);
        }

        // Return a 404 response if the path is not handled by the Durable Object.
        return new Response("Not found within Durable Object", { status: 404 });
    }
}


// This is the main Cloudflare Worker entry point.
// Its primary role is to act as a router, directing specific requests to your Durable Object.
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        let id: DurableObjectId;
        let stub: DurableObjectStub;

        // Check if the incoming request's path is for the MCP server or SSE.
        // If it is, we will forward it to the Durable Object.
        if (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/sse")) {
            // Obtain a Durable Object ID.
            // Using `idFromName` with a fixed name ensures that all requests for this
            // functionality go to the same single Durable Object instance.
            id = env.MCP_OBJECT.idFromName("MySingleMCPInstance");

            // Get a stub (a client-side proxy) to the Durable Object instance.
            stub = env.MCP_OBJECT.get(id);

            // Forward the original request to the Durable Object stub.
            // The DO's `fetch` method will then be invoked to handle the request.
            return stub.fetch(request);
        }

        // For any other paths not handled by the Durable Object, return a 404 from the Worker itself.
        return new Response("Not found in Worker entry point", { status: 404 });
    },
};
