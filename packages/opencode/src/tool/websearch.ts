import z from "zod"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"

const URL = "https://mcp.exa.ai/mcp"

const Parameters = z.object({
  query: z.string().describe("Websearch query"),
  numResults: z.number().optional().describe("Number of search results to return (default: 8)"),
  livecrawl: z
    .enum(["fallback", "preferred"])
    .optional()
    .describe(
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
    ),
  type: z
    .enum(["auto", "fast", "deep"])
    .optional()
    .describe("Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search"),
  contextMaxCharacters: z
    .number()
    .optional()
    .describe("Maximum characters for context string optimized for LLMs (default: 10000)"),
})

export const WebSearchTool = Tool.defineEffect(
  "websearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            ctx.ask({
              permission: "websearch",
              patterns: [params.query],
              always: ["*"],
              metadata: {
                query: params.query,
                numResults: params.numResults,
                livecrawl: params.livecrawl,
                type: params.type,
                contextMaxCharacters: params.contextMaxCharacters,
              },
            }),
          )

          const request = HttpClientRequest.post(URL).pipe(
            HttpClientRequest.setHeaders({
              accept: "application/json, text/event-stream",
              "content-type": "application/json",
            }),
            HttpClientRequest.bodyJsonUnsafe({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: {
                name: "web_search_exa",
                arguments: {
                  query: params.query,
                  type: params.type || "auto",
                  numResults: params.numResults || 8,
                  livecrawl: params.livecrawl || "fallback",
                  contextMaxCharacters: params.contextMaxCharacters,
                },
              },
            }),
          )

          const response = yield* http.execute(request).pipe(Effect.timeout("25 seconds"))

          if (response.status < 200 || response.status >= 300) {
            const text = yield* response.text
            throw new Error(`Search error (${response.status}): ${text}`)
          }

          const body = yield* response.text
          for (const line of body.split("\n")) {
            if (line.startsWith("data: ")) {
              const data = JSON.parse(line.substring(6))
              if (data.result?.content?.[0]?.text) {
                return {
                  output: data.result.content[0].text,
                  title: `Web search: ${params.query}`,
                  metadata: {},
                }
              }
            }
          }

          return {
            output: "No search results found. Please try a different query.",
            title: `Web search: ${params.query}`,
            metadata: {},
          }
        }).pipe(
          Effect.catchTag("TimeoutError", () => Effect.die(new Error("Search request timed out"))),
          Effect.runPromise,
        ),
    }
  }),
)
