# Gemini CLI UI

A Visual Studio Code extension that provides a beautiful, integrated chat interface for the [Gemini CLI](https://github.com/google/gemini-cli).

## Features

- **Integrated Sidebar Chat**: Chat with Gemini directly from your VS Code Activity Bar alongside your code.
- **Sessions Tree View**: Quickly access, resume, and manage your recent Gemini sessions in the sidebar.
- **Native Diff Editor**: Review suggested code changes side-by-side with your original file before applying them.
- **Syntax Highlighting**: Beautiful code blocks with GitHub Dark styling via `highlight.js`.
- **Markdown Support**: Rich text rendering including bold, italics, lists, and tables.
- **Streaming Responses**: Real-time message streaming with a "Thinking..." indicator.
- **Offline Support**: Fully bundled dependencies (`marked`, `highlight.js`) mean it works without an internet connection to external CDNs.
- **Smart Path Resolution**: Automatically discovers your local `gemini` installation via your system `PATH`.

## Requirements

You must have the [Gemini CLI](https://github.com/google/gemini-cli) installed and available in your system `PATH`.

```bash
npm install -g @google/gemini-cli
```

## Usage

1. Open VS Code.
2. Click the **Sparkle icon** in the Activity Bar (left sidebar) to open the Gemini Chat view.
3. Type your prompt and press **Enter** (Use **Shift+Enter** for newlines).

## Known Issues

- Make sure `gemini` is properly configured with your API key before using this extension.

## Release Notes

### 0.0.1

Initial release of Gemini CLI UI.
