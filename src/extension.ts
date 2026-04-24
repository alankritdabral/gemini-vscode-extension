import * as vscode from "vscode";
import { GeminiChatViewProvider } from "./chatViewProvider";

export function activate(context: vscode.ExtensionContext) {
  try {
    console.log("Gemini CLI Extension Host started");
    const outputChannel = vscode.window.createOutputChannel("Gemini CLI");
    context.subscriptions.push(outputChannel);

    const provider = new GeminiChatViewProvider(
      context.extensionUri,
      outputChannel,
      context,
    );

    const statusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    statusItem.text = "$(sparkle) Gemini: Idle";
    statusItem.command = "gemini-cli-ui.openChat";
    statusItem.show();
    context.subscriptions.push(statusItem);

    provider.onStateChange((state) => {
      if (state === "running") {
        statusItem.text = "$(sync~spin) Gemini: Thinking...";
        statusItem.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground",
        );
      } else {
        statusItem.text = "$(sparkle) Gemini: Idle";
        statusItem.backgroundColor = undefined;
      }
    });

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        GeminiChatViewProvider.viewType,
        provider,
      ),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("gemini-cli-ui.openChat", () => {
        vscode.commands.executeCommand(
          "workbench.view.extension.gemini-chat-explorer",
        );
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "gemini-cli-ui.resumeSession",
        async () => {
          const sessions = await provider.listSessions();
          if (sessions.length === 0) {
            vscode.window.showInformationMessage("No recent sessions found.");
            return;
          }

          const items = sessions.map((s) => ({
            label: s.summary,
            description: s.age,
            detail: s.id,
            index: s.index,
          }));

          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: "Select a session to resume",
          });

          if (selected) {
            provider.resumeSession(selected.detail);
          }
        },
      ),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("gemini-cli-ui.newSession", () => {
        provider.newSession();
      }),
      vscode.commands.registerCommand("gemini-cli-ui.refreshSessions", () => {
        provider.refreshSessions();
      }),
    );
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Failed to activate Gemini CLI UI: ${e.message}`,
    );
    console.error(e);
  }
}

export function deactivate() {}
