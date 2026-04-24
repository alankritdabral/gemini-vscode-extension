import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { GeminiProcess } from "./geminiProcess";
import { getSessions } from "./sessionManager";
import { getHtmlForWebview } from "./webviewContent";

export class GeminiChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "gemini-cli-ui.chatView";
  private _view?: vscode.WebviewView;
  private _activeProcess: GeminiProcess | null = null;
  private _currentSessionId: string = "latest";
  private _onStateChange: vscode.EventEmitter<"idle" | "running">;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _outputChannel: vscode.OutputChannel,
    private readonly _context: vscode.ExtensionContext,
  ) {
    this._onStateChange = new vscode.EventEmitter<"idle" | "running">();
  }

  private _saveHistory(messages: any[]) {
    const key = `history_${this._currentSessionId}`;
    this._context.workspaceState.update(key, messages);
  }

  private _getHistory(): any[] {
    const key = `history_${this._currentSessionId}`;
    return this._context.workspaceState.get<any[]>(key) || [];
  }

  public get onStateChange() {
    return this._onStateChange.event;
  }

  public async refreshSessions() {
    const sessions = await getSessions(this._outputChannel);
    this._view?.webview.postMessage({
      command: "updateSessions",
      sessions: sessions,
    });
  }

  public async listSessions(): Promise<any[]> {
    return getSessions(this._outputChannel);
  }

  public newSession() {
    this._activeProcess?.stop();
    this._activeProcess = null;
    this._currentSessionId = "latest";
    this._saveHistory([]);
    
    // Tell webview to reset UI
    this._view?.webview.postMessage({
      command: "newSession",
    });
    this._view?.webview.postMessage({
      command: "setActiveSession",
      sessionId: "latest",
    });

    // Send /clear command to CLI via the standard message handler
    // This ensures it's managed as the active process
    this._onSendMessage("/clear");
  }

  public async resumeSession(sessionId: string, sessionIndex?: string) {
    this._activeProcess?.stop();
    this._activeProcess = null;
    this._currentSessionId = sessionId;
    
    vscode.commands.executeCommand(
      "workbench.view.extension.gemini-chat-explorer",
    );

    // Fetch history from CLI using index (preferred) or UUID
    const tempProcess = new GeminiProcess(() => {}, () => {}, () => {}, this._outputChannel);
    const cliHistory = await tempProcess.fetchHistory(sessionIndex || sessionId);
    
    let history = cliHistory;
    if (history.length === 0) {
        // Fallback to workspace state if CLI history is empty
        history = this._getHistory();
    } else {
        // Update workspace state with CLI history
        this._saveHistory(history);
    }

    this._view?.webview.postMessage({
      command: "loadHistory",
      messages: history,
    });
    this._view?.webview.postMessage({
      command: "setActiveSession",
      sessionId: sessionId,
    });
    this._view?.webview.postMessage({
      command: "receiveMessage",
      text: `Resumed session: ${sessionId}`,
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = getHtmlForWebview(webviewView.webview, this._extensionUri);

    // Initial session load
    this.refreshSessions();

    // Load existing history
    const history = this._getHistory();
    if (history.length > 0) {
      webviewView.webview.postMessage({
        command: "loadHistory",
        messages: history,
      });
    }

    webviewView.webview.onDidReceiveMessage((data) => {
      this._outputChannel.appendLine(
        `[Extension] Received from Webview: ${data.command}`,
      );
      switch (data.command) {
        case "sendMessage":
          this._onSendMessage(data.text);
          break;
        case "updateHistory":
          this._saveHistory(data.messages);
          break;
        case "stopProcess":
          this._activeProcess?.stop();
          this._onStateChange.fire("idle");
          webviewView.webview.postMessage({
            command: "receiveError",
            text: "Process stopped by user.",
          });
          break;
        case "clearChat":
          this._activeProcess?.stop();
          this._activeProcess = null;
          this._currentSessionId = "latest";
          this._saveHistory([]);
          break;
        case "refreshSessions":
          this.refreshSessions();
          break;
        case "resumeSession":
          this.resumeSession(data.sessionId, data.sessionIndex);
          break;
        case "newSession":
          this.newSession();
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this._activeProcess?.stop();
      this._activeProcess = null;
    });
  }

  private _onSendMessage(text: string) {
    if (!this._view) {
      this._outputChannel.appendLine(
        "[Extension] Error: Webview reference is null!",
      );
      return;
    }

    this._activeProcess?.stop();
    this._onStateChange.fire("running");
    this._activeProcess = new GeminiProcess(
      (data) => {
        this._outputChannel.appendLine(
          `[Extension] UI Update: ${data.substring(0, 30)}...`,
        );
        this._view?.webview.postMessage({
          command: "receiveMessage",
          text: data,
        });
      },
      (error) => {
        this._outputChannel.appendLine(`[Extension] UI Error: ${error}`);
        this._view?.webview.postMessage({
          command: "receiveError",
          text: error,
        });
      },
      (code) => {
        this._outputChannel.appendLine(`[Extension] UI Process Exit: ${code}`);
        this._view?.webview.postMessage({ command: "processExit", code: code });
        this._activeProcess = null;
        this._onStateChange.fire("idle");
      },
      this._outputChannel,
      (suggestion) => {
        this._onCodeSuggestion(suggestion);
      },
    );
    this._activeProcess.start(text, this._currentSessionId);
  }

  private async _onCodeSuggestion(suggestion: {
    tool: string;
    parameters: any;
  }) {
    const { tool, parameters } = suggestion;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const cwd = workspaceFolders[0].uri.fsPath;
    const filePath = path.resolve(cwd, parameters.file_path);
    const fileName = path.basename(filePath);

    let originalContent = "";
    if (fs.existsSync(filePath)) {
      originalContent = fs.readFileSync(filePath, "utf8");
    }

    let newContent = "";
    if (tool === "write_file") {
      newContent = parameters.content;
    } else if (tool === "replace") {
      newContent = originalContent.replace(
        parameters.old_string,
        parameters.new_string,
      );
    }

    // Create a temporary file for the suggested content
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(
      tempDir,
      `gemini-suggestion-${Date.now()}-${fileName}`,
    );
    fs.writeFileSync(tempFilePath, newContent);

    const originalUri = vscode.Uri.file(filePath);
    const tempUri = vscode.Uri.file(tempFilePath);

    await vscode.commands.executeCommand(
      "vscode.diff",
      originalUri,
      tempUri,
      `Gemini: ${fileName} (Suggestion)`,
    );

    const action = await vscode.window.showInformationMessage(
      `Gemini suggested changes to ${fileName}. Do you want to apply them?`,
      "Apply",
      "Discard",
    );

    if (action === "Apply") {
      fs.writeFileSync(filePath, newContent);
      vscode.window.showInformationMessage(`Applied changes to ${fileName}`);
    } else if (action === "Discard") {
      if (
        (tool === "replace" || tool === "write_file") &&
        fs.existsSync(filePath)
      ) {
        // If it was already applied by the CLI (e.g. in auto_edit mode), we might need to revert.
        const currentContent = fs.readFileSync(filePath, "utf8");
        if (currentContent === newContent) {
          fs.writeFileSync(filePath, originalContent);
          vscode.window.showInformationMessage(
            `Reverted changes to ${fileName}`,
          );
        }
      }
    }

    // Clean up temp file
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (e) {}
  }
}
