import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Cloudflare Worker environment variables
interface Env {
  AUTOBOUND_API_KEY: string;
  PREDICTLEADS_API_KEY: string;
  PREDICTLEADS_API_TOKEN: string;
  YOUCOM_API_KEY: string;
}

export class MyMCP extends McpAgent {
  server = new McpServer({
    name: "Autobound MCP Multi-Tool",
    version: "1.0.0",
  });

  async init() {
    //
    // Tool 1: Autobound Generate Insights API (v1.4)
    //
    this.server.tool(
      "autoboundInsights",
      {
        contactEmail: z.string().email().optional(),
        contactLinkedinUrl: z.string().url().optional(),
        contactCompanyUrl: z.string().url().optional(),
        userEmail: z.string().email().optional(),
        userLinkedinUrl: z.string().url().optional(),
        userCompanyUrl: z.string().url().optional(),
        insightSubtype: z.union([z.string(), z.array(z.string())]).optional(),
      },
      async (params, { env }: { env: Env }) => {
        const apiKey = env.AUTOBOUND_API_KEY;
        if (!apiKey) {
          throw new Error("Missing AUTOBOUND_API_KEY secret");
        }

        const resp = await fetch(
          "https://api.autobound.ai/api/external/generate-insights/v1.4",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": apiKey,
            },
            body: JSON.stringify(params),
          }
        );

        if (!resp.ok) {
          const error = await resp.json().catch(() => ({}));
          throw new Error(
            `Autobound API error: ${error.message || resp.statusText}`
          );
        }

        const data = await resp.json();
        return { content: [{ type: "json", json: data }] };
      }
    );

    //
    // Tool 2: PredictLeads API (requires api_key + api_token)
    //
    this.server.tool(
      "predictLeads",
      {
        path: z.string().min(1), // e.g., "/companies/github.com"
        query: z.record(z.any()).optional(),
      },
      async ({ path, query }, { env }: { env: Env }) => {
        const apiKey = env.PREDICTLEADS_API_KEY;
        const apiToken = env.PREDICTLEADS_API_TOKEN;
        if (!apiKey || !apiToken) {
          throw new Error(
            "Missing PREDICTLEADS_API_KEY or PREDICTLEADS_API_TOKEN secret"
          );
        }

        const url = new URL(`https://predictleads.com/api/v3${path}`);
        url.searchParams.append("api_key", apiKey);
        url.searchParams.append("api_token", apiToken);

        if (query) {
          for (const [k, v] of Object.entries(query)) {
            url.searchParams.append(k, String(v));
          }
        }

        const resp = await fetch(url.toString(), { method: "GET" });

        if (!resp.ok) {
          const error = await resp.json().catch(() => ({}));
          throw new Error(
            `PredictLeads API error: ${error.message || resp.statusText}`
          );
        }

        const data = await resp.json();
        return { content: [{ type: "json", json: data }] };
      }
    );

    //
    // Tool 3: You.com Search API
    //
    this.server.tool(
      "youSearch",
      {
        query: z.string().min(1),
        numWebResults: z.number().optional(),
        freshness: z.enum(["day", "week", "month", "year"]).optional(),
        country: z.string().optional(),
        safesearch: z.enum(["off", "moderate", "strict"]).optional(),
      },
      async (
        { query, numWebResults, freshness, country, safesearch },
        { env }: { env: Env }
      ) => {
        const apiKey = env.YOUCOM_API_KEY;
        if (!apiKey) {
          throw new Error("Missing YOUCOM_API_KEY secret");
        }

        const url = new URL("https://api.ydc-index.io/v1/search");
        url.searchParams.append("query", query);
        if (numWebResults !== undefined) {
          url.searchParams.append("num_web_results", String(numWebResults));
        }
        if (freshness) url.searchParams.append("freshness", freshness);
        if (country) url.searchParams.append("country", country);
        if (safesearch) url.searchParams.append("safesearch", safesearch);

        const resp = await fetch(url.toString(), {
          method: "GET",
          headers: {
            "X-API-Key": apiKey,
          },
        });

        if (!resp.ok) {
          const error = await resp.json().catch(() => ({}));
          throw new Error(
            `You.com API error: ${error.detail || resp.statusText}`
          );
        }

        const data = await resp.json();
        return { content: [{ type: "json", json: data }] };
      }
    );
  }
}

// Worker entrypoint
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }
    if (url.pathname === "/mcp") {
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
