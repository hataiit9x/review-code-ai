# Product Overview

`@hataiit9x/review-code-ai` is a CLI tool for automated code review on GitLab Merge Requests using AI.

## Core Functionality
- Fetches MR diffs from GitLab API
- Sends code changes to AI (OpenAI or Gemini) for review
- Posts AI-generated review comments directly on the MR at relevant code locations

## Key Features
- Supports both OpenAI and Google Gemini as AI backends
- Configurable GitLab API URL for self-hosted instances
- Load balancing across multiple API keys
- Rate limit handling with automatic retry
- Designed for CI/CD pipeline integration

## Target Use Case
Automated code review in GitLab CI pipelines, triggered on merge request events.
