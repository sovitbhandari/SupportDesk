import { useEffect } from "react";
import { apiBaseUrl } from "../api/client";
import type { SseMessageEvent } from "../types";

const lastSequenceByTicket = new Map<string, number>();

export function useSseMessages(
  token: string | null,
  ticketId: string | null,
  onEvent: (event: SseMessageEvent) => void
) {
  useEffect(() => {
    if (!token || !ticketId) {
      return;
    }
    const activeTicketId = ticketId;

    const controller = new AbortController();
    let reconnectTimer: number | null = null;
    let stopped = false;
    let attempt = 0;

    const scheduleReconnect = () => {
      if (stopped) return;
      const jitter = Math.floor(Math.random() * 250);
      const waitMs = Math.min(1000 * 2 ** attempt, 5000) + jitter;
      attempt += 1;
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, waitMs);
    };

    async function connect() {
      try {
        const lastEventId = lastSequenceByTicket.get(activeTicketId);
        const params = new URLSearchParams();
        if (lastEventId !== undefined) {
          params.set("lastEventId", String(lastEventId));
        }
        const suffix = params.toString() ? `?${params.toString()}` : "";
        const response = await fetch(`${apiBaseUrl}/api/tickets/${activeTicketId}/stream${suffix}`, {
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

            const lines = chunk.split("\n");
            const eventLine = lines.find((line) => line.startsWith("event:"));
            const dataLines = lines
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.replace("data:", "").trimStart());

            const event = eventLine?.replace("event:", "").trim();
            const data = dataLines.join("\n").trim();

            if (event === "ticket.message.created" && data) {
              const parsed = JSON.parse(data) as SseMessageEvent;
              const previousSequence = lastSequenceByTicket.get(parsed.ticketId) ?? 0;
              if (parsed.sequence > previousSequence) {
                lastSequenceByTicket.set(parsed.ticketId, parsed.sequence);
              }
              onEvent(parsed);
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
  }, [token, ticketId, onEvent]);
}
