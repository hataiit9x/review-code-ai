# Tech Stack

## Language & Runtime
- TypeScript (strict mode)
- Node.js (ES2016 target, CommonJS modules)

## Dependencies
- `axios` - HTTP client for GitLab and AI API calls
- `commander` - CLI argument parsing

## Build System
- TypeScript compiler (`tsc`)
- Source files: `src/`
- Output directory: `lib/`
- Source maps enabled

## Commands

```bash
# Build (compile TypeScript)
npm run build

# Watch mode (development)
npm run start

# Install dependencies
npm install
```

## Package Distribution
- Published to npm as `@hataiit9x/review-code-ai`
- CLI binary exposed as `review-code-ai` via `bin/index.js`
- Distributed files: `lib/` and `bin/`
