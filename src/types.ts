export interface Session {
  index: string;
  summary: string;
  age: string;
  id: string;
}

export interface ChatMessage {
  text: string;
  type: "user" | "assistant" | "thinking";
}
