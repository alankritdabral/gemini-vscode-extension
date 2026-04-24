import * as vscode from "vscode";
import { spawn } from "node:child_process";
import * as os from "node:os";
import { Session } from "./types";

export async function getSessions(
  outputChannel: vscode.OutputChannel,
): Promise<Session[]> {
  const config = vscode.workspace.getConfiguration("gemini");
  let geminiPath = config.get<string>("cliPath");
  if (!geminiPath || geminiPath === "gemini") {
    geminiPath = "/home/alankrit/.nvm/versions/node/v20.20.2/bin/gemini";
  }
  const nodePath = "/home/alankrit/.nvm/versions/node/v20.20.2/bin/node";
  const fallbackCwd = os.tmpdir();
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || fallbackCwd;

  outputChannel.appendLine(
    `[Extension] Listing sessions with ${nodePath} ${geminiPath} in ${cwd}${cwd === fallbackCwd ? " (fallback)" : ""}`,
  );

  return new Promise((resolve) => {
    const child = spawn(nodePath, [geminiPath, "--list-sessions"], {
      cwd,
      env: {
        ...process.env,
        GEMINI_CLI_TRUST_WORKSPACE: "true",
      },
      shell: false,
    });

    let stdout = "";
    let errorOccurred = false;

    child.on("error", (err: any) => {
      errorOccurred = true;
      outputChannel.appendLine(`[Error] Failed to list sessions: ${err.message}`);
      resolve([]);
    });

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.on("close", (code) => {
      if (errorOccurred) return;
      if (code !== 0) {
        outputChannel.appendLine(
          `[Error] Failed to list sessions with code: ${code}`,
        );
        resolve([]);
        return;
      }

      const sessions: Session[] = [];
      const lines = stdout.split("\n");
      const sessionRegex = /^\s*(\d+)\.\s+(.+?)\s+\((.+?)\)\s+\[(.+?)\]/;

      for (const line of lines) {
        const match = line.match(sessionRegex);
        if (match) {
          sessions.push({
            index: match[1],
            summary: match[2],
            age: match[3],
            id: match[4],
          });
        }
      }
      resolve(sessions);
    });
  });
}
