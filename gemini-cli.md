# Executive Summary

We propose building a **Gemini CLI VS Code Extension** that wraps the Google Gemini CLI in a rich IDE interface. The extension will enumerate *Gemini CLI commands* (from the official cheat-sheet and docs【48†L258-L266】【48†L304-L312】) and map them to VS Code UI elements (command palette entries, tree views, input boxes, etc.). It will handle **authentication** by invoking the CLI’s Google OAuth or API-key flows【52†L314-L320】【52†L339-L347】, capture **streaming input/output** (JSONL events in headless mode【35†L268-L277】), manage background processes, and expose **error logging** via an Output channel. Configuration options (workspace- and user-scoped) will be defined in `package.json` with `contributes.configuration`【62†L379-L388】. The extension will register **activation events** (e.g. `onCommand:extension.runGemini`, `onView:geminiExplorer`) so it loads only when needed【64†L136-L144】. 

UI components will include: a *command* (palette) to start or resume Gemini sessions, an *integrated terminal* or *webview* for conversation, a *diff editor* for code suggestions, a *tree view* for project context or sessions, and *status bar* indicators【25†L136-L144】【28†L136-L144】. We will implement **process management** carefully (spawning the Gemini CLI via Node’s `child_process.spawn` or the VS Code Terminal API【33†L19-L23】), ensuring cross-platform compatibility. Packaging will use the `vsce` tool【16†L161-L169】; publishing requires an Azure DevOps PAT and compliance with extension marketplace rules【16†L197-L200】. 

The deliverables include architecture and flow diagrams (Mermaid), UI wireframes (sketches), an API mapping table, a milestone roadmap, effort estimates and risk matrix, sample TypeScript code snippets, CI/CD instructions (including use of `@vscode/test-electron` and Mocha【68†L136-L145】), and a user-docs outline. We recommend implementing the extension in **TypeScript/Node.js** (the standard VS Code extension framework), though other languages or LSP-based approaches could be explored. 

# Gemini CLI Capabilities (Features and Commands)

Gemini CLI provides a wide range of AI-agent features via both **interactive slash commands** (in the REPL) and **CLI subcommands and flags**. Key capabilities include natural-language prompts, code generation, file operations, tool execution, and project context awareness【36†L400-L408】. 

- **Interactive Commands (Slash)**: Within a `gemini` REPL, users type `/commands` (slash) to invoke features. For example, `/help`, `/quit`, `/memory`, `/tools`, `/resume`, etc. Common REPL commands include `/help` (show help), `/quit` (exit), `/memory reload`, `/agents reload`, etc【48†L288-L298】. (These slash-commands provide workspace context management and agent control as documented under “Interactive commands.”)

- **CLI Commands and Flags**: Outside the REPL, the `gemini` binary supports:
  - **Interactive Mode**: `gemini` (no args) enters REPL【48†L258-L266】.
  - **Non-interactive Query**: `gemini -p "prompt"` runs a single query in headless mode【48†L258-L262】.
  - **Combined**: `gemini "prompt"` runs then continues REPL.
  - **Piping Input**: `cat file | gemini` or PowerShell `Get-Content file | gemini` can feed file contents【48†L263-L270】.
  - **Prompt Interactive**: `gemini -i "prompt"` runs and remains interactive【48†L264-L270】.
  - **Resume Session**: `gemini -r "latest"` resumes last session; `-r <id>` resumes by ID【48†L267-L270】.
  - **Update**: `gemini update` updates the CLI【48†L270-L273】.
  - **Manage Extensions/MCP**: `gemini extensions` and `gemini mcp` subcommands open extension/MCP management (see docs).
  - **Options**: Flags include `--model`/`-m` (model name), `--sandbox` (safe mode), `--approval-mode`, `--extensions` list, `--output-format` (`text/json/stream-json`), etc.【48†L304-L313】【48†L331-L340】. For example, `--output-format json` yields a single JSON result; `--output-format stream-json` yields incremental JSONL events (see below)【35†L268-L277】. The cheat-sheet and command reference on the Gemini docs site list all CLI options and arguments【48†L304-L313】【48†L331-L340】.

- **Headless Streaming**: In “headless” mode (non-TTY), Gemini outputs structured JSON or JSONL. Streaming output includes event types like `init`, `message`, `tool_use`, `tool_result`, and a final `result`【35†L268-L277】. The extension can parse these events in real-time to update the UI. Exit codes `0-53` indicate success or various errors【35†L283-L292】.

- **Authentication**: Gemini CLI requires Google authentication. It typically uses browser-based OAuth: running `gemini` prompts the user to “Sign in with Google”, opening a web browser and caching credentials locally【52†L314-L320】. Alternatively, users can set a `GEMINI_API_KEY` environment variable with a Gemini API key from Google AI Studio【52†L339-L347】, or configure Vertex AI credentials (ADC, service account, etc.)【52†L381-L390】【52†L421-L429】. The extension should either rely on the CLI’s own auth flow (e.g. prompting `gemini auth login` in a terminal) or allow setting credentials via VS Code settings (e.g. a hidden API key) to the `GEMINI_API_KEY` env. It must respect security: e.g., not logging secrets, and instruct users to keep keys safe【52†L373-L379】. On **credential storage**, Gemini caches tokens on disk. The extension might need to handle edge cases (e.g. instruct user to re-authenticate if needed).

- **Configuration**: Gemini also supports project-level config (`GEMINI.md`, `.geminiignore`) and CLI config flags (e.g. `--worktree`). The extension could expose some Gemini settings (like `model` or `home` directory) via VS Code settings for convenience. For example, one could define settings like `geminiCLI.model`, `geminiCLI.sandbox`, etc., under `contributes.configuration` in `package.json`【62†L379-L388】. These settings can have default values and appear in the Settings UI.

In summary, we will *inventory* and support key Gemini CLI commands by parsing its documentation【48†L258-L270】【48†L304-L312】. Our extension UI will surface only the most essential commands (e.g. Run Session, Resume Session, Update, etc.) while letting advanced users still use the CLI directly in a terminal if needed.

# VS Code Extension APIs & UI Components

To integrate Gemini CLI into VS Code, we leverage the official Extension API and UX guides:

- **Commands & Command Palette**: The extension will define commands (e.g. `"geminiCLI.run"`, `"geminiCLI.resume"`, `"geminiCLI.openDiff"`) in `package.json` under `contributes.commands`【62†L363-L372】. These commands get entries in the Command Palette (and can have icons). Invoking a command (via palette or keybinding) emits an activation event `onCommand:geminiCLI.run`【62†L339-L342】, which can launch our logic. For example, `Gemini: Run` might start a new session; `Gemini: Resume` could show quick-pick of saved sessions; `Gemini: Accept Diff` and `Gemini: Reject Diff` can appear when a diff is open.

- **Activation Events**: To minimize startup cost, the extension will use activation events such as:
  - `onCommand:geminiCLI.run` (activate when the user runs the main command)【64†L139-L147】.
  - `onView:geminiExplorer` if we contribute a TreeView named `geminiExplorer`【23†L201-L204】.
  - `onLanguage:<language>` if context-specific (e.g. activate when a code file is open, if desired).
  - `workspaceContains:**/gemini.config` if we want auto-activation in projects with specific files【64†L136-L144】.
  - Perhaps `*` (always on) for experiments, though a good extension should be lazy-loaded【28†L136-L144】.

- **UI Components**:
  - **Webviews**: For custom UIs like a chat conversation or tools dashboard, we use a Webview Panel or Webview View. Webviews allow full HTML/JS, but should be used judiciously【28†L134-L142】. We might use a Webview for a rich chat interface (with formatted bubbles) and for a diff review interface. The guidelines warn to use webviews *only if necessary*【28†L136-L144】, so simpler UI (TreeViews, input boxes, terminals) is preferred where possible. Any webview content must be themeable and accessible【28†L141-L149】.
  - **Tree View**: We can show a **Gemini Explorer** in the side bar (e.g. under the Activity Bar). A `TreeDataProvider` will supply nodes such as sessions, discovered tools, or workspace context (e.g. file list)【23†L134-L142】【23†L153-L162】. In `package.json` we contribute the view under `views`, and implement `getChildren()` and `getTreeItem()` in code【23†L153-L162】【23†L221-L229】. Activation should include `onView:geminiExplorer` if targeting VS Code ≥1.74 (older versions require explicit activation)【23†L201-L204】.
  - **Status Bar**: A `StatusBarItem` can display Gemini status (e.g. “Gemini: idle” or “Gemini: running”) and act as a button. Use `window.createStatusBarItem()` and set `alignment: Left` for primary info【25†L136-L144】. Follow guidelines: short text, minimal icons【25†L139-L144】.
  - **Input Boxes & Quick Picks**: Use `vscode.window.showInputBox()` to prompt for text (e.g. “Enter prompt for Gemini”) or `showQuickPick()` for choices (e.g. select a saved session to resume). These are standard VS Code API calls.
  - **Integrated Terminal**: We can use the Terminal API (`window.createTerminal`) to run Gemini CLI interactively【33†L19-L23】. For example, “Gemini: Run” might open a new terminal, run `gemini`, and forward focus to it. We can send initial commands via `terminal.sendText(...)` if needed (see [33†L19-L23]). We can also listen to events like `window.onDidCloseTerminal` to clean up. Terminal integration ensures users who prefer the CLI feel are supported.
  - **Output Channel**: For logging and errors, create an `OutputChannel` (e.g. `window.createOutputChannel('Gemini CLI')`)【60†L612-L614】. All stderr from the CLI or debug info can be printed here for troubleshooting. Users can view it via “View → Output”.

- **Running the Gemini CLI**:
  - We have two options: spawn a child process using Node’s `child_process` or use a VS Code `Terminal`. For programmatic control (parsing JSON streams), `spawn` is more flexible: e.g., `const proc = spawn('gemini', ['-p', prompt], { stdio: ['ignore','pipe','pipe'] }); proc.stdout.on('data', …)`【33†L19-L23】. The `-p` flag will trigger headless JSON output【35†L268-L277】. We must handle the `data` events to update the UI, and `exit` or `error` events for cleanup. On Windows, we may need `shell: true` or proper quoting (Node spawn can run .cmd or .ps1). 
  - Alternatively, using the Terminal API (see [33†L19-L23]) spawns a UI terminal; however capturing its output for UI integration is harder (the API is evolving, [32†L966-L974] shows a proposed `onDidWriteTerminalData` listener). For simplicity, the extension can use a hidden `OutputChannel` or a Webview to display streaming text, or simply let the terminal show output to user.
  - **Process Management**: Track spawned processes so they can be terminated on deactivate or when user stops a session. Use `context.subscriptions.push(proc)` or explicitly kill processes (e.g. `proc.kill()`). Use `onDidCloseTerminal` to know when a terminal is closed. 

- **Cross-Platform Concerns**: 
  - On **Windows**, the default shell is PowerShell/Command Prompt, so running Unix-like commands may need adjustments. If using `spawn`, one should not hardcode shell commands (use `shell: true` or ensure `gemini` is in PATH as an `.exe` or `.cmd`). Environment variables (like `GEMINI_API_KEY`) are set differently (`$env:VAR` vs `export`). Node’s `path` API should be used for any file paths. 
  - On **macOS/Linux**, the CLI is typically a Unix executable (via npm or Homebrew). Terminal default is bash/zsh. The extension should detect the platform (`process.platform`) if any OS-specific handling is needed.
  - Generally, avoid shell-specific syntax in code; use Node APIs or double-quote arguments.

- **Error Handling and Logging**: 
  - The extension should catch errors from spawning processes, parse non-zero exit codes (Gemini uses codes 1,42,53 for errors【35†L283-L292】) and report them clearly. For example, show an error notification (`window.showErrorMessage`) on failure and log details in the Output channel. 
  - When parsing JSON, wrap in try/catch. If the Gemini CLI outputs an `error` event in its JSON stream, handle it appropriately (e.g. show warnings).
  - Use an Output channel (as above) for verbose debug logs (`--debug` mode of CLI) so advanced users can troubleshoot.

- **Configuration and Settings**: 
  - Define user settings via `contributes.configuration` in `package.json`【62†L379-L388】. Possible settings include: `geminiCLI.apiKey`, `geminiCLI.googleProject`, `geminiCLI.model`, `geminiCLI.sandbox`, etc. Each property should have a description and default. In code, read them via `const cfg = vscode.workspace.getConfiguration('geminiCLI'); cfg.get('model')` etc【62†L414-L418】. 
  - Distinguish *global* vs *workspace* settings by setting the `scope` appropriately in `package.json` (user vs. workspace). For example, a project-specific setting might be `geminiCLI.includeDirectories`.
  - If users have a local `.gemini` or `GEMINI.md`, consider detecting that file via `workspaceContains` to activate or to set default behavior.

- **Telemetry/Privacy**: 
  - If the extension collects usage data (for e.g. anonymous feature use), it must respect user preference. Microsoft’s telemetry guide recommends using the `@vscode/extension-telemetry` NPM package for consistency【21†L148-L156】. If using it, require the user’s Application Insights key and call `new TelemetryReporter(...)`. 
  - Always check `vscode.env.isTelemetryEnabled` (formerly `isTelemetryEnabled`) before sending any events【21†L159-L168】. Provide a setting (e.g. `geminiCLI.enableTelemetry`) to let users opt out. 
  - No sensitive data (like prompts or API keys) should be sent. Clarify in privacy documentation what is collected (e.g. extension version, OS, command usage count).
  - Adhere to VS Code’s privacy requirements and link to its privacy statements【21†L136-L144】.

# Architecture Design 

Below is a high-level architecture diagram (Mermaid) showing the main components and data flow. 

```mermaid
flowchart LR
  subgraph VSCode["VS Code / Extension Host"]
    A[User Actions (Commands, Clicks)] 
    B[Commands & UI (StatusBar, TreeView, Webview)]
    C[Extension Backend (Process Manager, Handlers)]
    D[Output Channel / Logger]
  end
  subgraph GeminiCLI["Gemini CLI (External Process)"]
    G[Gemini Process (JSON/Text I/O)]
  end
  A -->|invoke| B
  B -->|calls command| C
  C -->|spawn gemini| G
  G -->|stdout (JSON / text)| C
  G -->|stderr| D
  C -->|log/status| D
  C -->|update UI| B
```

**Figure:** *Architecture: the extension backend (in the Extension Host) registers UI commands and manages a Gemini CLI process. When the user invokes a Gemini command (via command palette, button, or menu), the extension spawns the `gemini` CLI (headless). The CLI’s stdout (JSON streams) is fed back to the extension, which parses it and updates the UI components (webviews, diff editors, status bar). Errors and debug logs go to an OutputChannel.* 

Key points:
- The **Extension Host** (Node.js) bridges between VS Code and the Gemini CLI process. It handles commands, spawns processes, parses output, and controls VS Code UI APIs.
- The Gemini CLI runs as a **child process** (or integrated terminal). It’s decoupled from VS Code internals except through I/O.
- A persistent **OutputChannel** captures logs and errors.

# User Interface (Wireframes & Flows)

We envision the following UI flow and mockups:

- **Command Palette / Quick Actions**: 
  - *“Gemini: Run”*: Presents an input box (“Enter prompt:”). After entering, the extension spawns `gemini -i "prompt"` or opens a new terminal running `gemini`. Output appears in a panel.
  - *“Gemini: Resume Session”*: Shows a QuickPick list of recent sessions (using `--list-sessions` output). Choosing one runs `gemini -r <id>`.
  - *“Gemini: View History”*: (Optional) opens a tree or list of saved chat history.
  - *“Gemini: Accept Diff”* / *“Close Diff”*: Appear only when a diff editor (opened by Gemini suggestion) is active【11†L297-L303】. These simply commit or reject the code patch.

- **Chat Panel (Webview)**: 
  - Could mimic chat UI with alternating user/assistant messages and tool outputs. A Webview panel or sidebar view might show conversation. The user can type new prompts at the bottom. This is similar to how ChatGPT extensions work, but must use `webview` carefully【28†L136-L144】.
  - Alternatively, simpler: each prompt spawns a message in an output-like panel. We might not implement a full chat UI initially.

- **Diff Editor (Native)**: 
  - When Gemini suggests code edits (e.g. using `/run` with code generation), the extension should open a VS Code diff editor showing “Original” vs “Proposed changes.” See CLI docs: “native diffing” is mentioned【11†L283-L292】. We can apply the diff as an edit if the user accepts, else revert.
  - This uses VS Code’s standard diff editor: e.g. `vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, 'Gemini Suggestion')`.

- **Gemini Explorer (TreeView)**:
  - A side-bar tree could list project context: e.g. “Recent Files”, “Open File Snippets”, “Memory” or “Sessions”. Clicking might show content or run commands. This leverages the Tree View API【23†L134-L142】.
  - Example nodes: “Sessions” (expand to individual session IDs, double-click to resume), “Tools” (list custom tools), “Extensions” (list enabled Gemini extensions).

- **Status Bar Item**:
  - A small item on the left: “Gemini: Idle” (clickable to show quick actions). When a session is running, it might show “Gemini: Running…”.
  - Following status bar guidelines: short text/icons【25†L139-L144】. It could display token usage count or connection status.

Overall, the UI will feel similar to other Chat-oriented extensions: command-driven, with optional chat-like or diff view. The main interactions (prompt, accept diff) align with the Gemini CLI Companion’s described VS Code features【11†L297-L303】【11†L349-L357】.

# Gemini CLI ↔ Extension Command Mapping

| **Gemini CLI Feature/Command**         | **Extension UI Element or Flow**                                         |
|---------------------------------------|-------------------------------------------------------------------------|
| `gemini` (start REPL)                 | **Command Palette** “Gemini: Run” — opens terminal with `gemini`         |
| `gemini -p "<query>"` (non-inter)     | Input Box (or Webview) for prompt, then spawn CLI in background, show result in panel or Webview (JSON parsed). |
| `gemini -r <session>` (resume)        | **QuickPick** list of sessions (using `--list-sessions` output), then run CLI. |
| `gemini update`                       | **Command Palette** “Gemini: Update” — runs update command (notify on success). |
| `/quit`, `/help` etc in REPL          | Routed to CLI (user can open integrated terminal to run these).         |
| `/memory`, `/undo`, `/resume`, etc.   | Not directly UI; user can use CLI or extension may surface some via TreeView. |
| Code suggestions (diff)               | Automatically open **Diff Editor**. Then **Commands** to Accept/Reject (Diff buttons). |
| Gemini status or errors               | **Output Channel** shows logs; **Status Bar** shows busy/idle; **Notifications** on critical errors. |
| `gemini --list-sessions`              | Called internally to populate session list in UI.                        |
| `gemini extensions list`              | Could populate **TreeView** under “Extensions” node.                      |
| `gemini mcp`                          | Possibly open settings or webview for MCP config.                         |
| `gemini --version`                    | (Not directly needed in UI; maybe display version in About/Notices).      |
| **Global config flags** (`--model`, etc.) | Exposed as VS Code **Settings** (`geminiCLI.model`, etc.)【62†L414-L418】. |
| Authentication (oauth / API key)      | On first run, prompt user to run `gemini` in terminal, or allow setting `GEMINI_API_KEY` via config. |

*Table:* Mapping of Gemini CLI commands and options to extension UI actions and elements. (Some advanced features like slash-commands in REPL are simply handled by the CLI terminal.) This ensures users can access Gemini’s functionality through intuitive VS Code flows.

# Implementation Roadmap and Milestones

We suggest the following phased roadmap, each with deliverables and approximate effort:

| **Milestone**                        | **Tasks**                                                                                                     | **Est. Effort (dev-weeks)** |
|--------------------------------------|---------------------------------------------------------------------------------------------------------------|-----------------------------|
| 1. **Requirements & Architecture**   | Finalize feature list (from Gemini docs), design extension architecture, tech stack (TypeScript/Node).         | 1–2                         |
| 2. **Dev Environment Setup**         | Scaffold extension (e.g. `yo code`), install dependencies (`@vscode/vsce`, testing). Configure repo/CI.      | 1                           |
| 3. **Core CLI Invocation**           | Implement child_process spawn of Gemini CLI with JSON parsing. Test headless output handling.                 | 2                           |
| 4. **Basic Commands**                | Add command palette actions: Run, Resume, Update. Wire up spawn calls.                                       | 1–2                         |
| 5. **UI Components - Terminal**      | Integrate integrated terminal for interactive mode.                                                         | 1                           |
| 6. **UI Components - Status Bar**    | Add a StatusBarItem showing Gemini status.                                                                  | 0.5                         |
| 7. **UI - Webview / Chat**           | (Optional) Implement a Webview panel for chat conversation.                                                  | 2                           |
| 8. **UI - Diff Editor**             | Detect code suggestions, open diff editor, implement Accept/Reject commands.                                 | 2                           |
| 9. **Tree View & Context**           | Build a TreeDataProvider for sessions or workspace context (recent files).                                   | 1.5                         |
| 10. **Settings & Config**            | Define `contributes.configuration` for Gemini options. Read/write config.                                    | 1                           |
| 11. **Authentication Support**       | Guide users through `gemini auth`, or allow API key input (link to docs). Possibly detect auth status.      | 1–2                         |
| 12. **Error Handling & Logging**     | Ensure CLI stderr captured in OutputChannel. Display error messages/notifications.                           | 1                           |
| 13. **Telemetry/Opt-in**            | Integrate `@vscode/extension-telemetry` (if telemetry used). Respect `telemetry.telemetryLevel`.             | 1                           |
| 14. **Testing & QA**                 | Write unit tests, integration tests (using `@vscode/test-electron`【68†L136-L145】). Manual UX testing.       | 2                           |
| 15. **Documentation & Polish**       | Write README, docs (usage, configuration). Polish UI (icons, labels). Complete architecture diagram.         | 1                           |
| 16. **CI/CD Pipeline**               | Add GitHub Actions for build, package, test. `npm publish` with `vsce` on tag.                                | 1                           |
| 17. **Marketplace Publishing**       | Prepare `package.json` (icon, metadata), obtain PAT, and publish to VSCode Marketplace and Open VSX.         | 0.5                         |

_Total Estimated Development Effort:_ ~17–20 developer-weeks.

Progress should be tracked with issues/milestones. Early proofs of concept (e.g. spawning CLI and showing output) can validate feasibility quickly.

# Risk Assessment

We identify key risks and mitigations:

| **Risk**                                          | **Likelihood** | **Impact** | **Mitigation**                                                         |
|---------------------------------------------------|---------------|------------|------------------------------------------------------------------------|
| **Gemini CLI API changes** (breaking changes)     | Medium        | High       | Track Gemini CLI releases【11†L249-L258】, maintain compatibility shims. Limit support to stable release channel. |
| **Parsing streaming JSON output**                 | Medium        | Medium     | Test thoroughly with varied outputs. Use robust JSONL parsing (partial chunks). Provide fallback on parse errors. |
| **Authentication complexities** (Google/GCP flows)| Medium        | Medium     | Defer auth to CLI’s mechanisms. Document clearly. Allow API key as option. |
| **Cross-platform child_process issues**           | Medium        | Medium     | Use Node `spawn` with `shell: true` on Windows. Test on Windows/macOS/Linux. |
| **VS Code API limitations** (e.g. terminal output)| Low           | Low        | Use OutputChannel if needed. Keep up to date with VS Code API (e.g. proposed terminal API). |
| **Security/Privacy** (leaking data)               | Low           | High       | Do not log sensitive info. Clearly document privacy. Use VS Code opt-out settings. |
| **Performance** (workspace scanning latency)      | Medium        | Medium     | Cache context, limit files read (respect `.geminiignore`). Lazy-load heavy features. |
| **User confusion** (UI mapping for CLI)           | Medium        | Low        | Provide help docs, intuitive labels. Include tooltips.              |
| **Extension review/rejection** (Marketplace)      | Low           | Medium     | Follow marketplace guidelines. Use approved libraries.             |

*Table:* Risk matrix (Likelihood/Impact) with mitigations. By anticipating changes and building flexibility, we reduce maintenance and user frustration.

# Sample Code Snippets

Below are illustrative TypeScript snippets for key functions:

- **Spawning Gemini CLI in Headless Mode (streaming JSON)**:
  
  ```ts
  import { spawn } from 'child_process';

  const geminiProcess = spawn('gemini', ['-p', query, '--output-format', 'stream-json'], { 
    stdio: ['ignore', 'pipe', 'pipe'] 
  });

  geminiProcess.stdout.on('data', data => {
    const chunk = data.toString();
    try {
      const event = JSON.parse(chunk);
      // e.g., handle event.type === 'message' or 'result'
      handleGeminiEvent(event);
    } catch (e) {
      console.error('Failed to parse Gemini JSON:', e);
    }
  });

  geminiProcess.stderr.on('data', data => {
    outputChannel.appendLine(`[Gemini CLI stderr] ${data}`);
  });

  geminiProcess.on('exit', code => {
    if (code !== 0) {
      vscode.window.showErrorMessage(`Gemini CLI exited with code ${code}`);
    }
  });
  ```

- **Creating a Status Bar Item**:
  
  ```ts
  import * as vscode from 'vscode';

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.text = '$(rocket) Gemini: Idle';
  statusItem.command = 'geminiCLI.run';
  statusItem.tooltip = 'Start Gemini CLI';
  statusItem.show();
  context.subscriptions.push(statusItem);
  ```

- **Defining and Reading Configuration** (`package.json` excerpt + usage):
  
  ```jsonc
  // In package.json
  "contributes": {
    "configuration": {
      "title": "Gemini CLI",
      "properties": {
        "geminiCLI.model": {
          "type": "string",
          "default": "gemini-4o",
          "description": "Gemini model to use (auto for automatic selection)."
        },
        "geminiCLI.sandbox": {
          "type": "boolean",
          "default": false,
          "description": "Run Gemini in sandbox mode (safer execution)."
        }
      }
    }
  }
  ```
  ```ts
  // In extension code
  const cfg = vscode.workspace.getConfiguration('geminiCLI');
  const model = cfg.get<string>('model', 'auto');
  const sandbox = cfg.get<boolean>('sandbox', false);
  // Use these when constructing gemini command
  ```

- **Accepting a Diff** (applying code suggestion):
  
  ```ts
  vscode.commands.registerCommand('geminiCLI.acceptDiff', async () => {
    // Assume diff editor is open on the active editor
    // We can apply the diff by copying text from right pane to left file.
    const active = vscode.window.activeTextEditor;
    if (active) {
      const edits = active.document; // Simplified; actual diff handling requires diff APIs
      // (Implementation would compute the edits between original and modified documents)
      // For brevity, assume entire modified content is applied:
      const originalUri = /* original file URI */;
      const modifiedUri = /* diff URI */;
      const originalDoc = await vscode.workspace.openTextDocument(originalUri);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(originalUri, new vscode.Range(
        originalDoc.positionAt(0), originalDoc.positionAt(originalDoc.getText().length)),
        (await vscode.workspace.openTextDocument(modifiedUri)).getText());
      await vscode.workspace.applyEdit(edit);
      // Close diff editor
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
  });
  ```

- **Publishing with vsce**:
  
  ```bash
  npm install -g @vscode/vsce
  vsce package    # creates .vsix
  vsce publish   # publishes to Marketplace (requires PAT config)
  ```

*(Note: These snippets are illustrative and simplified; actual implementation will handle many edge cases.)* 

# CI/CD and Publishing Steps

We will use standard VS Code extension practices for build and release:

- **Version Control & CI**: Host on GitHub. Set up GitHub Actions (or equivalent) to:
  - Run `npm install` and compile TypeScript on push.
  - Run unit tests (`npm test`) and integration tests (via `@vscode/test-electron`)【68†L136-L145】.
  - (Optional) Linting and packaging check.
  - On a release tag, run `vsce package` to create the `.vsix`.
  
- **Continuous Integration Tests**: Use `@vscode/test-cli` / `@vscode/test-electron` with Mocha【68†L155-L163】. Write integration tests that launch the extension in the VS Code Test runner, simulate user commands, and verify UI outcomes.

- **Publishing**:
  1. **Register Publisher**: Create an Azure DevOps organization or use personal publisher for the marketplace.
  2. **Get Personal Access Token (PAT)**: As per VS Code docs【16†L201-L209】, generate a PAT with **All accessible organizations -> Marketplace (Manage)** scope.
  3. **package.json Metadata**: Ensure `publisher`, `name`, `version`, `engines.vscode` fields are set. Include a PNG icon (no SVG) in `media/` or root.
  4. **Marketplace/VSX**: 
     - Use `vsce publish` from CLI with `--pat <token>`. For VS Code forks, also publish to Open VSX Registry【11†L337-L345】.
     - The first publish may require logging in with `vsce login <publisher>`.
  5. **Changelog & Documentation**: Follow marketplace guidelines for README, Changelog, and add an icon that does not violate SVG rules【16†L181-L189】.

- **Telemetry Compliance**: If telemetry is used, include appropriate notices as per Microsoft’s Extension Telemetry guide【21†L136-L144】【21†L159-L168】.

# Licensing, Telemetry, and Privacy

- **License**: The Gemini CLI itself is Apache-2.0 licensed【36†L405-L408】. We should choose a compatible open-source license for the extension (Apache-2.0 or MIT are common for VS Code extensions). We will include license files and third-party notices if any dependencies require it.

- **Telemetry and Privacy**: 
  - Follow VS Code’s Telemetry guidelines【21†L136-L144】. If collecting usage data (e.g. command usage counts), use `@vscode/extension-telemetry` to send anonymized events【21†L148-L156】. 
  - Respect the user setting `telemetry.telemetryLevel`: do not send if user has disabled telemetry【21†L159-L168】.
  - If not using telemetry, provide a clear statement (e.g. “This extension does not collect any usage data.”).
  - Include privacy statement in documentation, and mention if any data is logged (only generic error stats, not user queries).

# Testing Strategy

Ensuring quality involves:

- **Unit Tests**: For core logic (e.g. parsing JSON events, formatting outputs). Use Mocha/Jest. No VS Code API needed here.
- **Integration Tests**: Using the VS Code Test Runner (via `@vscode/test-electron`)【68†L136-L145】. Write tests that activate the extension in a mock workspace, run extension commands, and verify outcomes (e.g., that a terminal is opened, or a webview content is correct). Use the “Ext UI” testing runner to simulate UI interactions if needed.
- **Manual QA / UX**: Hands-on testing on Windows, macOS, Linux. Validate:
  - Gemini commands work (try core scenarios: prompt, resume, code generation).
  - UI components appear as expected (status bar, tree, etc.).
  - Error cases: no login, wrong input, environment without Gemini installed.
- **Performance**: Test with large workspaces to ensure background context extraction is efficient. Possibly mock large folder in tests.

# User Documentation Outline

Documentation for end-users (e.g. in a README or dedicated guide) will cover:

1. **Overview**: What the extension does (integrating Gemini CLI into VS Code).
2. **Installation**: Via VS Code Marketplace or VSIX. (Mention Open VSX for forks【11†L337-L345】.)
3. **Getting Started**:
   - Prerequisites: Gemini CLI installed (mention npm or brew).
   - First Run: How to authenticate (point to Gemini CLI auth docs)【52†L314-L320】【52†L339-L347】.
4. **Commands & UI**:
   - Explanation of palette commands (“Gemini: Run”, “Resume”, etc.).
   - How to enter a prompt (input box) or use terminal.
   - Viewing and accepting code diffs (illustration).
   - Using the Gemini Explorer tree view (if implemented).
   - Status Bar indicator meaning.
5. **Configuration**:
   - List of extension settings (model, sandbox, API key storage).
   - How to set workspace vs user settings.
6. **Authentication**:
   - How to use Google Sign-In (via CLI).
   - How to set an API key (`geminiCLI.apiKey` or environment).
7. **Known Issues**:
   - Platform caveats (Windows path, etc.).
   - Debugging steps (check Output panel).
8. **Privacy**: State telemetry policy.
9. **Development/Contributing** (optional): How others can contribute or build from source.
10. **Changelog / Version History**.

A concise quick-reference table of commands could be included, mapping Gemini CLI flags to extension actions.

# Architecture and Flow Diagrams

```mermaid
flowchart TD
  subgraph "User"
    U((User))
  end
  subgraph "VS Code UI"
    CP[Command Palette]
    TR[Input Box / QuickPick]
    ST[Status Bar Item]
    WV[Webview/Chat Panel]
    DIFF[Diff Editor]
    OU[Output Channel]
  end
  subgraph "Extension Host"
    EX[Extension Backend]
    TRM[Process Manager]
  end
  subgraph "Gemini CLI"
    GC([Gemini CLI Process])
  end

  U -->|invoke command| CP
  CP --> EX
  CP --> ST
  EX --> TR
  TR --> EX
  EX -->|spawn gemini| GC
  GC -->|stdout (JSON)| EX
  EX --> WV
  GC -->|stdout (text)| DIFF
  EX --> DIFF
  GC -->|stderr| OU
  EX --> OU
  EX --> ST
```

**Figure:** *Interaction flow: The user invokes a command via the Command Palette or Status Bar. The extension’s backend handles it, possibly showing an Input Box. It then spawns the Gemini CLI as a child process. Gemini’s output (JSON or text) is streamed back to the extension, which updates the Webview/chat panel or opens a diff editor. Errors go to the Output Channel. The status bar item reflects the running state.*

This chart illustrates the dynamic sequence of user input, extension action, Gemini CLI execution, and UI updates. It highlights the *real-time streaming* path (Gemini -> Extension -> Webview) and the *batch flow* (user prompt -> CLI -> diff editor).

*Sources:* Gemini CLI and VS Code docs (Gemini streaming events【35†L268-L277】, extension status bar and webview guidelines【25†L136-L144】【28†L134-L142】). 

