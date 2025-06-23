import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Extend the Request type to include a potential 'token' property
// This is a common pattern for middleware that adds properties to the request object.
declare global {
	interface Request {
		token?: string;
	}
}

// Define our MCP agent with tools
// We will modify this to accept a token in its constructor or a method.
export class MyMCP extends McpAgent {
	server: McpServer;
	private authToken?: string; // Property to store the auth token

	constructor(authToken?: string) {
		super();
		this.authToken = authToken; // Store the token
		this.server = new McpServer({
			name: "Authless Calculator", // You might want to rename this if it's no longer "Authless"
			version: "1.0.0",
		});
		// Call init here to ensure tools are registered when the agent is constructed
		this.init();
	}

	async init() {
		// Simple addition tool
		this.server.tool(
			"add",
			{ a: z.number(), b: z.number() },
			async ({ a, b }) => {
				// You can now access this.authToken here
				console.log("Auth Token in 'add' tool:", this.authToken);
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
			async ({ operation, a, b }) => {
				// You can now access this.authToken here
				console.log("Auth Token in 'calculate' tool:", this.authToken);

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

	// You might want a way to get the server instance to serve requests.
	// This method will provide a new instance of McpServer configured with the agent's tools.
	getMcpServer() {
		return this.server;
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		// 1. Extract the Auth Token
		// Common ways to pass an auth token:
		//    a) Via an "Authorization" header (e.g., Bearer token)
		//    b) Via a query parameter (less secure for sensitive tokens, but simple for examples)

		let authToken: string | undefined;

		// Option a: From Authorization header
		const authHeader = request.headers.get("Authorization");
		if (authHeader && authHeader.startsWith("Bearer ")) {
			authToken = authHeader.slice(7); // "Bearer ".length = 7
		}

		// Option b: From a query parameter (e.g., /mcp?token=YOUR_TOKEN) - Use with caution for sensitive data
		// if (!authToken) { // Only try query param if not found in header
		// 	authToken = url.searchParams.get("token");
		// }

		// 2. Instantiate MyMCP with the token
		const mcpAgentInstance = new MyMCP(authToken);

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			// Ensure that serveSSE also correctly uses the instance's server
			return mcpAgentInstance.getMcpServer().serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			// Ensure that serve also correctly uses the instance's server
			return mcpAgentInstance.getMcpServer().serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
