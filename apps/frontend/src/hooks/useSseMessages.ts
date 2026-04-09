import { useEffect } from "react";
import { apiBaseUrl } from "../api/client";
import type { SseMessageEvent } from "../types";

export function useSseMessages(token: string | null, onEvent: (event: SseMessageEvent) => void) {
  useEffect(() => {
    if (!token) {
      return;
    }

    const controller = new AbortController();
    let reconnectTimer: number | null = null;
    let stopped = false;
    let attempt = 0;

    const scheduleReconnect = () => {
      if (stopped) return;
      const waitMs = Math.min(1000 * 2 ** attempt, 5000);
      attempt += 1;
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, waitMs);
    };

    async function connect() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        });

        if (!response.ok || !response.body) {
          scheduleReconnect();
          return;
        }

        attempt = 0;
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
        scheduleReconnect();
      } catch {
        scheduleReconnect();
      }
    }

    void connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      controller.abort();
    };
  }, [token, onEvent]);
}
