import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Import DurableObjectState and DurableObject if you're extending it directly
import { DurableObjectState, DurableObject } from '@cloudflare/workers-types'; // Assuming you have these types installed

// Define our MCP agent with tools
// MyMCP should now extend DurableObject and accept DurableObjectState
export class MyMCP extends DurableObject { // Extend DurableObject
    server: McpServer;
    private authToken?: string;
    private state: DurableObjectState; // Store the state object

    // The constructor must accept DurableObjectState as the first argument
    constructor(state: DurableObjectState, env: Env) { // env is also commonly passed here
        super(state, env); // Call the base DurableObject constructor
        this.state = state; // Store the state object for later use if needed

        // Initialize McpServer without an initial token, as the token comes per-request
        this.server = new McpServer({
            name: "Auth Calculator", // Renamed as it will now handle auth
            version: "1.0.0",
        });

        // Initialize tools here. The token will be passed via the request context.
        this.init();
    }

    async init() {
        // Simple addition tool
        this.server.tool(
            "add",
            { a: z.number(), b: z.number() },
            // The context object passed to tool functions can contain request-specific data
            async ({ a, b }, context: { authToken?: string }) => {
                console.log("Auth Token in 'add' tool:", context.authToken);
                // Use context.authToken for authentication/authorization logic
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
            async ({ operation, a, b }, context: { authToken?: string }) => {
                console.log("Auth Token in 'calculate' tool:", context.authToken);
                // Use context.authToken for authentication/authorization logic

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

    // Handle incoming requests for the Durable Object
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // 1. Extract the Auth Token from the request
        let authToken: string | undefined;
        const authHeader = request.headers.get("Authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
            authToken = authHeader.slice(7);
        }

        // 2. Pass the authToken into the MCP server's context
        // MCP's serve methods can take a context object as a third argument
        const context = { authToken }; // Create a context object

        if (url.pathname === "/sse" || url.pathname === "/sse/message") {
            // Pass the context to serveSSE
            return this.server.serveSSE("/sse").fetch(request, this.state, context as any); // Type assertion might be needed depending on MCP SDK types
        }

        if (url.pathname === "/mcp") {
            // Pass the context to serve
            return this.server.serve("/mcp").fetch(request, this.state, context as any); // Type assertion might be needed depending on MCP SDK types
        }

        return new Response("Not found", { status: 404 });
    }
}

// The Durable Object binding in your worker entry point
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        let id: DurableObjectId;
        let stub: DurableObjectStub;

        if (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/sse")) {
            // Get or create a Durable Object ID
            // For a single global DO, you might use a fixed ID:
            id = env.MY_MCP_DO.idFromName("MySingleMCPInstance");

            // Or if you want a new DO per user/session, generate it dynamically:
            // id = env.MY_MCP_DO.newUniqueId();

            stub = env.MY_MCP_DO.get(id);

            // Forward the request to the Durable Object
            return stub.fetch(request);
        }

        return new Response("Not found", { status: 404 });
    },
};

// You need to define your Durable Object in your wrangler.toml:
// [[durable_objects.bindings]]
// name = "MY_MCP_DO" # This name should match env.MY_MCP_DO
// class_name = "MyMCP" # This should match your class export name
