import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import path from "path"
import { LSP } from "../lsp"
import DESCRIPTION from "./lsp.txt"
import { Instance } from "../project/instance"
import { pathToFileURL } from "url"
import { assertExternalDirectory } from "./external-directory"
import { Filesystem } from "../util/filesystem"

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

export const LspTool = Tool.defineEffect(
  "lsp",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service

    return {
      description: DESCRIPTION,
      parameters: z.object({
        operation: z.enum(operations).describe("The LSP operation to perform"),
        filePath: z.string().describe("The absolute or relative path to the file"),
        line: z.number().int().min(1).describe("The line number (1-based, as shown in editors)"),
        character: z.number().int().min(1).describe("The character offset (1-based, as shown in editors)"),
      }),
      execute: (args: { operation: (typeof operations)[number]; filePath: string; line: number; character: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(Instance.directory, args.filePath)
          yield* Effect.promise(() => assertExternalDirectory(ctx, file))
          yield* Effect.promise(() =>
            ctx.ask({ permission: "lsp", patterns: ["*"], always: ["*"], metadata: {} }),
          )

          const uri = pathToFileURL(file).href
          const pos = { file, line: args.line - 1, character: args.character - 1 }
          const rel = path.relative(Instance.worktree, file)
          const title = `${args.operation} ${rel}:${args.line}:${args.character}`

          if (!(yield* Effect.promise(() => Filesystem.exists(file)))) throw new Error(`File not found: ${file}`)
          if (!(yield* lsp.hasClients(file))) throw new Error("No LSP server available for this file type.")
          yield* lsp.touchFile(file, true)

          const result: unknown[] = yield* (() => {
            switch (args.operation) {
              case "goToDefinition":
                return lsp.definition(pos)
              case "findReferences":
                return lsp.references(pos)
              case "hover":
                return lsp.hover(pos)
              case "documentSymbol":
                return lsp.documentSymbol(uri)
              case "workspaceSymbol":
                return lsp.workspaceSymbol("")
              case "goToImplementation":
                return lsp.implementation(pos)
              case "prepareCallHierarchy":
                return lsp.prepareCallHierarchy(pos)
              case "incomingCalls":
                return lsp.incomingCalls(pos)
              case "outgoingCalls":
                return lsp.outgoingCalls(pos)
            }
          })()

          return {
            title,
            metadata: { result },
            output: result.length === 0 ? `No results found for ${args.operation}` : JSON.stringify(result, null, 2),
          }
        }).pipe(Effect.runPromise),
    }
  }),
)
