# Project Context: Gemini CLI VS Code Extension

## Overview
This extension provides a rich IDE interface for the Google Gemini CLI. It enables users to interact with the Gemini AI agent directly from the VS Code sidebar, maintaining project context and session history.

## Architecture
- **Extension Host (Node.js/TypeScript)**: Manages the lifecycle of the extension, registers VS Code commands, and handles the Webview provider.
- **Gemini Process Manager (`geminiProcess.ts`)**: Spawns the `gemini` CLI binary as a child process using `--output-format stream-json`. It handles complex JSONL parsing and multi-line buffer management.
- **Webview UI (Inline HTML/JS/CSS)**: A self-contained chat interface that communicates with the extension host via `postMessage`. It supports real-time streaming, "Thinking" indicators, and history rendering.
- **Persistence**: Uses VS Code's `workspaceState` to store chat history keyed by Gemini Session IDs.

## Technical Key Findings & Fixes
- **CLI Requirements**: The Gemini CLI requires a valid Git repository in the working directory to function.
- **Dependency Conflicts**: Local `electron` dependencies in `package.json` must be avoided as they conflict with VS Code's built-in Electron runtime.
- **JSON Streaming**: The CLI often sends JSON fragments without trailing newlines. The extension implements a robust "buffer flush" logic on process exit to ensure no data is lost.
- **Module System**: The extension is configured as **CommonJS** to ensure maximum compatibility with the VS Code Extension Host environment.

## Extension Settings
- `gemini.cliPath`: Path to the gemini binary (defaults to `gemini`).
