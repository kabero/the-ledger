# The Ledger - Development Guide

## Project Structure
- packages/core - Business logic, DB, types (SQLite + better-sqlite3)
- packages/api - HTTP API server (Hono + tRPC)
- packages/mcp - MCP server for LLM tool access
- packages/web - React SPA (Vite + React)

## Build & Dev
- `pnpm install` - Install dependencies
- `pnpm dev` - Start all packages in dev mode (turbo)
- `cd packages/core && pnpm build` - Build core (required before API starts)
- `pnpm lint` - Run biome check
- `pnpm lint:fix` - Auto-fix lint issues

## Coding Rules
- TypeScript strict mode enabled
- Use biome for formatting and linting
- Tags: lowercase English, max 20 chars, use hyphens not spaces
- All entry mutations go through EntryService (not repository directly)
- Images stored in ~/.theledger/images/, results in ~/.theledger/results/

## Worker Scope Constraints
When assigning tasks to Worker agents, always specify file scope:
- Worker-UI: packages/web/src/** only
- Worker-Core: packages/core/src/** and packages/mcp/src/** only
- Worker-API: packages/api/src/** only
- Never assign the same file to two Workers

## Testing
- Core tests: `cd packages/core && pnpm test`
- Web e2e: Playwright (not yet configured)
