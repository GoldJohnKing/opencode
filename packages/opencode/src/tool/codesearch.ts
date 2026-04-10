import z from "zod"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Tool } from "./tool"
import DESCRIPTION from "./codesearch.txt"

const URL = "https://mcp.exa.ai/mcp"

export const CodeSearchTool = Tool.defineEffect(
  "codesearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    return {
      description: DESCRIPTION,
      parameters: z.object({
        query: z
          .string()
          .describe(
            "Search query to find relevant context for APIs, Libraries, and SDKs. For example, 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'",
          ),
        tokensNum: z
          .number()
          .min(1000)
          .max(50000)
          .default(5000)
          .describe(
            "Number of tokens to return (1000-50000). Default is 5000 tokens. Adjust this value based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.",
          ),
      }),
      execute: (params: { query: string; tokensNum: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            ctx.ask({
              permission: "codesearch",
              patterns: [params.query],
              always: ["*"],
              metadata: {
                query: params.query,
                tokensNum: params.tokensNum,
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
                name: "get_code_context_exa",
                arguments: {
                  query: params.query,
                  tokensNum: params.tokensNum || 5000,
                },
              },
            }),
          )

          const response = yield* http.execute(request).pipe(Effect.timeout("30 seconds"))

          if (response.status < 200 || response.status >= 300) {
            const errorText = yield* response.text
            throw new Error(`Code search error (${response.status}): ${errorText}`)
          }

          const responseText = yield* response.text

          // Parse SSE response
          for (const line of responseText.split("\n")) {
            if (line.startsWith("data: ")) {
              const data = JSON.parse(line.substring(6))
              if (data.result?.content?.[0]?.text) {
                return {
                  output: data.result.content[0].text,
                  title: `Code search: ${params.query}`,
                  metadata: {},
                }
              }
            }
          }

          return {
            output:
              "No code snippets or documentation found. Please try a different query, be more specific about the library or programming concept, or check the spelling of framework names.",
            title: `Code search: ${params.query}`,
            metadata: {},
          }
        }).pipe(
          Effect.catchTag("TimeoutError", () => Effect.die(new Error("Code search request timed out"))),
          Effect.runPromise,
        ),
    }
  }),
)
