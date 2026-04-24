"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const chatViewProvider_1 = require("./chatViewProvider");
function activate(context) {
    try {
        console.log("Gemini CLI Extension Host started");
        const outputChannel = vscode.window.createOutputChannel("Gemini CLI");
        context.subscriptions.push(outputChannel);
        const provider = new chatViewProvider_1.GeminiChatViewProvider(context.extensionUri, outputChannel, context);
        const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusItem.text = "$(sparkle) Gemini: Idle";
        statusItem.command = "gemini-cli-ui.openChat";
        statusItem.show();
        context.subscriptions.push(statusItem);
        provider.onStateChange((state) => {
            if (state === "running") {
                statusItem.text = "$(sync~spin) Gemini: Thinking...";
                statusItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
            }
            else {
                statusItem.text = "$(sparkle) Gemini: Idle";
                statusItem.backgroundColor = undefined;
            }
        });
        context.subscriptions.push(vscode.window.registerWebviewViewProvider(chatViewProvider_1.GeminiChatViewProvider.viewType, provider));
        context.subscriptions.push(vscode.commands.registerCommand("gemini-cli-ui.openChat", () => {
            vscode.commands.executeCommand("workbench.view.extension.gemini-chat-explorer");
        }));
        context.subscriptions.push(vscode.commands.registerCommand("gemini-cli-ui.resumeSession", async () => {
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
        }));
        context.subscriptions.push(vscode.commands.registerCommand("gemini-cli-ui.newSession", () => {
            provider.newSession();
        }), vscode.commands.registerCommand("gemini-cli-ui.refreshSessions", () => {
            provider.refreshSessions();
        }));
    }
    catch (e) {
        vscode.window.showErrorMessage(`Failed to activate Gemini CLI UI: ${e.message}`);
        console.error(e);
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map