# Project Structure

```
├── src/                  # TypeScript source files
│   ├── index.ts          # CLI entry point, orchestrates the review flow
│   ├── gitlab.ts         # GitLab API client (MR info, diffs, comments)
│   ├── openai.ts         # OpenAI API client for code review
│   ├── gemini.ts         # Google Gemini API client for code review
│   ├── types.ts          # Shared TypeScript interfaces
│   ├── prompts.ts        # AI prompt templates and configurations
│   └── utils.ts          # Helper functions (delay, diff parsing)
├── bin/                  # CLI executable wrapper
├── lib/                  # Compiled JavaScript output (generated)
├── package.json          # Project metadata and scripts
└── tsconfig.json         # TypeScript configuration
```

## Architecture Pattern
- `IAIClient` interface defines common contract for AI providers
- Each AI provider (OpenAI, Gemini) implements `IAIClient` with `reviewCodeChange(diff: string)` method
- `GitLab` class handles all GitLab API interactions
- `prompts.ts` contains AI prompt templates, `utils.ts` has helper functions
- Main flow in `index.ts` coordinates GitLab diff fetching → AI review → comment posting

## Code Conventions
- Classes for API clients (`GitLab`, `OpenAI`, `Gemini`)
- Interfaces prefixed with `I` (e.g., `IGitLabConfig`, `IAIClient`)
- Async/await for all API operations
- Export `run` function as module entry point
