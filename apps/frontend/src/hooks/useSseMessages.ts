import { useEffect } from "react";
import { apiBaseUrl } from "../api/client";
import type { SseMessageEvent } from "../types";

export function useSseMessages(token: string | null, onEvent: (event: SseMessageEvent) => void) {
  useEffect(() => {
    if (!token) {
      return;
    }

    const controller = new AbortController();

    async function connect() {
      const response = await fetch(`${apiBaseUrl}/api/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let idx = buffer.indexOf("\n\n");
        while (idx !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          const eventLine = chunk.split("\n").find((line) => line.startsWith("event:"));
          const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));

          const event = eventLine?.replace("event:", "").trim();
          const data = dataLine?.replace("data:", "").trim();

          if (event === "ticket.message.created" && data) {
            onEvent(JSON.parse(data) as SseMessageEvent);
          }

          idx = buffer.indexOf("\n\n");
        }
      }
    }

    void connect();
    return () => controller.abort();
  }, [token, onEvent]);
}
