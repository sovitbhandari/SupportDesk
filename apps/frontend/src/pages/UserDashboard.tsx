import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { createTicket, listTickets } from "../api/endpoints";
import { ChatPanel } from "../components/ChatPanel";
import { useAuth } from "../hooks/useAuth";
import { useSseMessages } from "../hooks/useSseMessages";
import type { Message, SseMessageEvent, Ticket } from "../types";

export function UserDashboard() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [view, setView] = useState<"open" | "solved">("open");
  const [incomingMessages, setIncomingMessages] = useState<Message[]>([]);

  const ticketsQuery = useQuery({
    queryKey: ["tickets"],
    queryFn: () => listTickets(token!),
    enabled: Boolean(token),
    refetchInterval: 10000
  });

  const myTickets = useMemo(() => {
    const all = (ticketsQuery.data ?? []).filter((ticket) => ticket.requester_id === user?.userId);
    if (view === "solved") {
      return all.filter((t) => t.status === "resolved" || t.status === "closed");
    }
    return all.filter((t) => t.status !== "resolved" && t.status !== "closed");
  }, [ticketsQuery.data, user?.userId, view]);

  const createTicketMutation = useMutation({
    mutationFn: (input: { subject: string; description: string }) =>
      createTicket(token!, { ...input, priority: "medium" }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["tickets"] });
      const previous = queryClient.getQueryData<Ticket[]>(["tickets"]) ?? [];
      const optimistic: Ticket = {
        id: `optimistic-${Date.now()}`,
        organization_id: user!.organizationId,
        requester_id: user!.userId,
        subject: input.subject,
        description: input.description,
        status: "open",
        priority: "medium",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      queryClient.setQueryData<Ticket[]>(["tickets"], [optimistic, ...previous]);
      return { previous };
    },
    onError: (_error, _input, context) => {
      queryClient.setQueryData(["tickets"], context?.previous ?? []);
      alert("Ticket creation failed. Reverted optimistic update.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    }
  });

  const onSseEvent = useCallback((event: SseMessageEvent) => {
    const message: Message = {
      id: event.messageId,
      organization_id: event.organizationId,
      ticket_id: event.ticketId,
      author_id: event.senderId,
      body: event.body,
      created_at: event.createdAt
    };

    setIncomingMessages((previous) => {
      if (previous.some((msg) => msg.id === message.id)) {
        return previous;
      }
      return [...previous, message];
    });
  }, []);

  useSseMessages(token, onSseEvent);

  const selectedTicket = myTickets.find((ticket) => ticket.id === selectedTicketId) ?? null;

  return (
    <div className="workspace-grid">
      <section className="ticket-list-pane">
        <div className="pane-header">
          <h3>My Requests</h3>
          <div className="segmented">
            <button className={view === "open" ? "seg-btn active" : "seg-btn"} onClick={() => setView("open")}>open</button>
            <button className={view === "solved" ? "seg-btn active" : "seg-btn"} onClick={() => setView("solved")}>solved</button>
          </div>
        </div>

        <form
          className="ticket-create"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const subject = String(form.get("subject") ?? "").trim();
            const description = String(form.get("description") ?? "").trim();
            if (!subject || !description) {
              return;
            }
            createTicketMutation.mutate({ subject, description });
            (event.currentTarget as HTMLFormElement).reset();
          }}
        >
          <input name="subject" placeholder="Subject" />
          <textarea name="description" placeholder="Describe your issue" rows={3} />
          <button type="submit">Submit Request</button>
        </form>

        <div className="ticket-list">
          {myTickets.map((ticket) => (
            <article
              key={ticket.id}
              className={selectedTicketId === ticket.id ? "ticket-card active" : "ticket-card"}
              onClick={() => setSelectedTicketId(ticket.id)}
            >
              <div className="ticket-card-top">
                <strong>{ticket.subject}</strong>
                <span className={`status ${ticket.status}`}>{ticket.status}</span>
              </div>
              <p className="muted">{ticket.description.slice(0, 72)}</p>
              <small>Updated {new Date(ticket.updated_at).toLocaleString()}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="ticket-detail-pane">
        {selectedTicket ? (
          <>
            <div className="pane-header">
              <div>
                <h3>{selectedTicket.subject}</h3>
                <p className="muted">Status: {selectedTicket.status}</p>
              </div>
              <span className="pill">{selectedTicket.priority}</span>
            </div>
            <ChatPanel
              ticket={selectedTicket}
              incomingMessages={incomingMessages.filter((m) => m.ticket_id === selectedTicket.id)}
            />
          </>
        ) : (
          <div className="empty-state">Select a request to view conversation.</div>
        )}
      </section>
    </div>
  );
}
