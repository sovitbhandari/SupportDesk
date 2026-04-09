import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { assignTicket, listTickets, updateTicketStatus } from "../api/endpoints";
import { ChatPanel } from "../components/ChatPanel";
import { useAuth } from "../hooks/useAuth";
import { useSseMessages } from "../hooks/useSseMessages";
import type { Message, SseMessageEvent, Ticket } from "../types";

type QueueView = "assigned" | "claim" | "solved";

export function AgentDashboard() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [view, setView] = useState<QueueView>("assigned");
  const [incomingMessages, setIncomingMessages] = useState<Message[]>([]);

  const assignedQuery = useQuery({
    queryKey: ["tickets", "assigned"],
    queryFn: () => listTickets(token!, { assignedToMe: true }),
    enabled: Boolean(token),
    refetchInterval: 5000
  });

  const claimableQuery = useQuery({
    queryKey: ["tickets", "claimable"],
    queryFn: () => listTickets(token!, { unassigned: true, status: "open" }),
    enabled: Boolean(token),
    refetchInterval: 5000
  });

  const claimMutation = useMutation({
    mutationFn: (ticketId: string) => assignTicket(token!, ticketId),
    onMutate: async (ticketId) => {
      await queryClient.cancelQueries({ queryKey: ["tickets", "claimable"] });
      const prevClaimable = queryClient.getQueryData<Ticket[]>(["tickets", "claimable"]) ?? [];
      queryClient.setQueryData<Ticket[]>(
        ["tickets", "claimable"],
        prevClaimable.filter((ticket) => ticket.id !== ticketId)
      );
      return { prevClaimable };
    },
    onError: (_error, _ticketId, ctx) => {
      queryClient.setQueryData(["tickets", "claimable"], ctx?.prevClaimable ?? []);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    }
  });

  const resolveMutation = useMutation({
    mutationFn: (ticketId: string) => updateTicketStatus(token!, ticketId, "resolved"),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    }
  });

  const queueTickets = useMemo(() => {
    if (view === "assigned") {
      return (assignedQuery.data ?? []).filter(
        (ticket) => ticket.status === "open" || ticket.status === "pending"
      );
    }
    if (view === "claim") return claimableQuery.data ?? [];
    return (assignedQuery.data ?? []).filter(
      (ticket) => ticket.status === "resolved" || ticket.status === "closed"
    );
  }, [view, assignedQuery.data, claimableQuery.data]);

  const selectedTicket =
    [...(assignedQuery.data ?? []), ...(claimableQuery.data ?? [])].find(
      (ticket) => ticket.id === selectedTicketId
    ) ?? null;

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
      if (previous.some((m) => m.id === message.id)) {
        return previous;
      }
      return [...previous, message];
    });
  }, []);

  useSseMessages(token, onSseEvent);

  return (
    <div className="workspace-grid">
      <section className="ticket-list-pane">
        <div className="pane-header">
          <h3>Agent Tickets</h3>
          <div className="segmented">
            {(["assigned", "claim", "solved"] as const).map((option) => (
              <button
                key={option}
                className={view === option ? "seg-btn active" : "seg-btn"}
                onClick={() => setView(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="ticket-list">
          {queueTickets.map((ticket) => (
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
              <div className="ticket-card-bottom">
                <small>Priority: {ticket.priority}</small>
                {view === "claim" && (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      claimMutation.mutate(ticket.id);
                    }}
                    disabled={claimMutation.isPending}
                  >
                    Claim
                  </button>
                )}
              </div>
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
                <p className="muted">Assigned: {selectedTicket.active_assignment_agent_id ?? "Unassigned"}</p>
              </div>
              <span className="pill">{selectedTicket.priority}</span>
            </div>
            {selectedTicket.status !== "resolved" && selectedTicket.status !== "closed" && (
              <div className="panel" style={{ marginBottom: 10 }}>
                <button onClick={() => resolveMutation.mutate(selectedTicket.id)}>
                  Mark as solved
                </button>
              </div>
            )}
            <ChatPanel
              ticket={selectedTicket}
              incomingMessages={incomingMessages.filter((m) => m.ticket_id === selectedTicket.id)}
            />
          </>
        ) : (
          <div className="empty-state">Select a ticket to open details and conversation.</div>
        )}
      </section>
    </div>
  );
}
