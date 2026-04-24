import * as vscode from "vscode";

export function getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri) {
    return `
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <style>
              body {
                padding: 0;
                margin: 0;
                display: flex;
                flex-direction: column;
                height: 100vh;
                background-color: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
                font-family: var(--vscode-font-family);
                overflow: hidden;
              }
              #main-container {
                display: flex;
                flex-direction: row;
                height: 100vh;
                width: 100%;
                overflow: hidden;
              }
              #sessions-sidebar {
                width: 150px;
                min-width: 100px;
                border-right: 1px solid var(--vscode-widget-border);
                display: flex;
                flex-direction: column;
                background-color: var(--vscode-sideBar-background);
                flex-shrink: 0;
              }
              #sessions-header {
                padding: 8px;
                font-weight: bold;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid var(--vscode-widget-border);
                font-size: 11px;
                text-transform: uppercase;
              }
              #sessions-list {
                flex: 1;
                overflow-y: auto;
                padding: 4px;
              }
              .session-item {
                padding: 6px 8px;
                cursor: pointer;
                border-radius: 4px;
                margin-bottom: 2px;
                font-size: 12px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }
              .session-item:hover {
                background-color: var(--vscode-list-hoverBackground);
              }
              .session-item.active {
                background-color: var(--vscode-list-activeSelectionBackground);
                color: var(--vscode-list-activeSelectionForeground);
              }
              .session-age {
                font-size: 10px;
                opacity: 0.6;
                display: block;
              }
              #chat-container {
                display: flex;
                flex-direction: column;
                flex: 1;
                height: 100vh;
                position: relative;
                min-width: 0;
              }
              #messages {
                flex: 1;
                overflow-y: auto;
                padding: 15px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                min-height: 0;
              }
              .message {
                padding: 10px 14px;
                border-radius: 6px;
                max-width: 90%;
                word-wrap: break-word;
                white-space: pre-wrap;
                font-size: var(--vscode-font-size);
              }
              .user-message {
                align-self: flex-end;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
              }
              .assistant-message {
                align-self: flex-start;
                background-color: var(--vscode-editorWidget-background);
                border: 1px solid var(--vscode-widget-border);
                color: var(--vscode-editorWidget-foreground);
              }
              .assistant-message.thinking {
                font-style: italic;
                opacity: 0.6;
                animation: pulse 1.5s infinite;
              }
              @keyframes pulse {
                0% { opacity: 0.3; }
                50% { opacity: 0.7; }
                100% { opacity: 0.3; }
              }
              #input-container {
                padding: 12px;
                border-top: 1px solid var(--vscode-widget-border);
                display: flex;
                flex-direction: column;
                gap: 10px;
                background-color: var(--vscode-editor-background);
              }
              #prompt {
                width: 100%;
                min-height: 60px;
                padding: 8px;
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                resize: none;
                box-sizing: border-box;
                font-family: inherit;
              }
              #controls {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
              }
              button {
                padding: 4px 12px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                cursor: pointer;
                border-radius: 2px;
                font-size: 12px;
              }
              button:hover {
                background-color: var(--vscode-button-hoverBackground);
              }
              #status-bar {
                font-size: 10px;
                opacity: 0.7;
                padding: 4px 12px;
                border-top: 1px solid var(--vscode-widget-border);
                background: var(--vscode-sideBar-background);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }
              .icon-button {
                background: none;
                padding: 2px;
                color: inherit;
              }
              .icon-button:hover {
                background: var(--vscode-toolbar-hoverBackground);
              }
            </style>
          </head>
          <body>
            <div id="main-container">
              <div id="sessions-sidebar">
                <div id="sessions-header">
                  <span>Sessions</span>
                  <div style="display: flex; gap: 4px;">
                    <button id="new-session-btn" class="icon-button" title="New Session">+</button>
                    <button id="refresh-sessions-btn" class="icon-button" title="Refresh Sessions">↻</button>
                  </div>
                </div>
                <div id="sessions-list"></div>
              </div>

              <div id="chat-container">
                <div id="messages"></div>

                <div id="input-container">
                  <textarea id="prompt" placeholder="Ask Gemini..."></textarea>
                  <div id="controls">
                    <button id="clear-btn">Clear</button>
                    <button id="send-btn">Send</button>
                  </div>
                </div>

                <div id="status-bar">Ready</div>
              </div>
            </div>

            <script>
              (function () {
                const vscode = acquireVsCodeApi();
                const msgContainer = document.getElementById("messages");
                const sessionsList = document.getElementById("sessions-list");
                const input = document.getElementById("prompt");
                const status = document.getElementById("status-bar");
                let messages = [];
                let currentMsg = null;
                let thinking = null;
                let activeSessionId = 'latest';

                function add(text, type, skipSave = false) {
                  const div = document.createElement("div");
                  div.className = "message " + type + "-message";
                  div.textContent = text;
                  msgContainer.appendChild(div);
                  msgContainer.scrollTop = msgContainer.scrollHeight;

                  if (!skipSave && type !== "thinking") {
                    messages.push({ text, type });
                    vscode.postMessage({
                      command: "updateHistory",
                      messages: messages,
                    });
                  }
                  return div;
                }

                function handleSend() {
                  const text = input.value.trim();
                  if (!text) return;
                  add(text, "user");
                  thinking = add("Gemini is thinking...", "assistant", true);
                  thinking.classList.add("thinking");
                  vscode.postMessage({ command: "sendMessage", text: text });
                  input.value = "";
                  currentMsg = null;
                }

                document.getElementById("send-btn").onclick = handleSend;
                input.onkeydown = (e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend();
                };
                document.getElementById("clear-btn").onclick = () => {
                  msgContainer.innerHTML = "";
                  messages = [];
                  vscode.postMessage({ command: "clearChat" });
                };
                document.getElementById("refresh-sessions-btn").onclick = () => {
                  vscode.postMessage({ command: "refreshSessions" });
                };
                document.getElementById("new-session-btn").onclick = () => {
                  vscode.postMessage({ command: "newSession" });
                };

                window.addEventListener("message", (event) => {
                  const m = event.data;

                  if (m.command === "newSession") {
                    msgContainer.innerHTML = "";
                    messages = [];
                    activeSessionId = 'latest';
                    document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
                    status.textContent = "New Session";
                    return;
                  }

                  if (m.command === "setActiveSession") {
                    activeSessionId = m.sessionId;
                    document.querySelectorAll('.session-item').forEach(el => {
                      if (el.dataset.id === m.sessionId) {
                        el.classList.add('active');
                      } else {
                        el.classList.remove('active');
                      }
                    });
                    if (m.sessionId !== 'latest') {
                      status.textContent = "Session: " + m.sessionId;
                    }
                    return;
                  }

                  if (m.command === "loadHistory") {
                    msgContainer.innerHTML = "";
                    messages = m.messages || [];
                    messages.forEach((msg) => add(msg.text, msg.type, true));
                    return;
                  }

                  if (m.command === "updateSessions") {
                    sessionsList.innerHTML = "";
                    m.sessions.forEach(s => {
                      const item = document.createElement("div");
                      item.className = "session-item" + (s.id === activeSessionId ? " active" : "");
                      item.dataset.id = s.id;
                      item.title = s.summary;
                      item.innerHTML = '<div>' + s.summary + '</div><span class="session-age">' + s.age + '</span>';
                      item.onclick = () => {
                        activeSessionId = s.id;
                        vscode.postMessage({ 
                          command: "resumeSession", 
                          sessionId: s.id,
                          sessionIndex: s.index 
                        });
                        document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
                        item.classList.add('active');
                        status.textContent = "Session: " + s.id;
                      };
                      sessionsList.appendChild(item);
                    });
                    return;
                  }

                  if (thinking) {
                    thinking.remove();
                    thinking = null;
                  }

                  if (m.command === "receiveMessage") {
                    if (m.text.startsWith("[Tool")) {
                      add(m.text, "assistant");
                      currentMsg = null;
                    } else {
                      if (!currentMsg) {
                        currentMsg = add(m.text, "assistant");
                      } else {
                        currentMsg.textContent += m.text;
                        const lastMsg = messages[messages.length - 1];
                        if (lastMsg && lastMsg.type === "assistant") {
                          lastMsg.text = currentMsg.textContent;
                          vscode.postMessage({
                            command: "updateHistory",
                            messages: messages,
                          });
                        }
                        msgContainer.scrollTop = msgContainer.scrollHeight;
                      }
                    }
                  } else if (m.command === "receiveError") {
                    add("Error: " + m.text, "assistant");
                  } else if (m.command === "processExit") {
                    currentMsg = null;
                    vscode.postMessage({ command: "refreshSessions" });
                  }
                });
              })();
            </script>
          </body>
        </html>
        `;
}
