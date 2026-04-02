import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { assignTicket, listEmployees, listTickets, updateEmployee, updateTicketStatus } from "../api/endpoints";
import { ChatPanel } from "../components/ChatPanel";
import { useAuth } from "../hooks/useAuth";

export function AdminDashboard() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [view, setView] = useState<"open" | "solved">("open");
  const [assignAgentId, setAssignAgentId] = useState<string>("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleSuccess, setRoleSuccess] = useState<string | null>(null);

  const ticketsQuery = useQuery({
    queryKey: ["tickets", view],
    queryFn: () => listTickets(token!, { status: view === "open" ? "open" : "resolved" }),
    enabled: Boolean(token),
    refetchInterval: 8000
  });

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => listEmployees(token!),
    enabled: Boolean(token)
  });

  const assignMutation = useMutation({
    mutationFn: (payload: { ticketId: string; agentId: string }) =>
      assignTicket(token!, payload.ticketId, payload.agentId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    onSuccess: () => {
      setAssignSuccess("Ticket assigned successfully");
      setAssignError(null);
    },
    onError: (error) => {
      setAssignSuccess(null);
      setAssignError(error instanceof Error ? error.message : "Assignment failed");
    }
  });

  const roleMutation = useMutation({
    mutationFn: (payload: { id: string; role: "admin" | "agent" | "customer" }) =>
      updateEmployee(token!, payload.id, { role: payload.role }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onSuccess: () => {
      setRoleSuccess("Employee role updated");
      setRoleError(null);
    },
    onError: (error) => {
      setRoleSuccess(null);
      setRoleError(error instanceof Error ? error.message : "Failed to update employee role");
    }
  });

  const resolveMutation = useMutation({
    mutationFn: (ticketId: string) => updateTicketStatus(token!, ticketId, "resolved"),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    }
  });

  const agents = useMemo(
    () => (employeesQuery.data ?? []).filter((e) => e.role === "agent" && e.is_active),
    [employeesQuery.data]
  );

  const selectedTicket = (ticketsQuery.data ?? []).find((t) => t.id === selectedTicketId) ?? null;

  return (
    <div className="workspace-grid">
      <section className="ticket-list-pane">
        <div className="pane-header">
          <h3>Admin Ticket Queue</h3>
          <div className="segmented">
            <button className={view === "open" ? "seg-btn active" : "seg-btn"} onClick={() => setView("open")}>open</button>
            <button className={view === "solved" ? "seg-btn active" : "seg-btn"} onClick={() => setView("solved")}>solved</button>
          </div>
        </div>

        <div className="ticket-list">
          {(ticketsQuery.data ?? []).map((ticket) => (
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
              <small>Assigned: {ticket.active_assignment_agent_id ?? "Unassigned"}</small>
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
                <p className="muted">Requester: {selectedTicket.requester_id}</p>
              </div>
              <span className="pill">{selectedTicket.priority}</span>
            </div>

            <div className="panel" style={{ marginBottom: 10 }}>
              <h4>Manual Assignment</h4>
              <div className="chat-form">
                <select value={assignAgentId} onChange={(e) => setAssignAgentId(e.target.value)}>
                  <option value="">Select agent</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.full_name} ({agent.email})</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    if (!assignAgentId) {
                      setAssignError("Please select an agent first.");
                      return;
                    }
                    assignMutation.mutate({ ticketId: selectedTicket.id, agentId: assignAgentId });
                  }}
                >
                  Assign
                </button>
              </div>
              {assignError && <p className="warning">{assignError}</p>}
              {assignSuccess && <p className="success">{assignSuccess}</p>}
            </div>
            {selectedTicket.status !== "resolved" && selectedTicket.status !== "closed" && (
              <div className="panel" style={{ marginBottom: 10 }}>
                <button onClick={() => resolveMutation.mutate(selectedTicket.id)}>
                  Move to solved
                </button>
              </div>
            )}

            <div className="panel" style={{ marginBottom: 10 }}>
              <h4>Employee Role Management</h4>
              {(employeesQuery.data ?? []).map((employee) => (
                <div key={employee.id} className="list-item">
                  <span>
                    {employee.full_name} ({employee.role}) {!employee.is_active ? "- inactive" : ""}
                  </span>
                  <select
                    value={employee.role}
                    disabled={roleMutation.isPending}
                    onChange={(e) =>
                      roleMutation.mutate({
                        id: employee.id,
                        role: e.target.value as "admin" | "agent" | "customer"
                      })
                    }
                  >
                    <option value="admin">admin</option>
                    <option value="agent">agent</option>
                    <option value="customer">customer</option>
                  </select>
                  {employee.id === user?.userId && <small className="muted">You</small>}
                </div>
              ))}
              {roleError && <p className="warning">{roleError}</p>}
              {roleSuccess && <p className="success">{roleSuccess}</p>}
            </div>

            <ChatPanel ticket={selectedTicket} incomingMessages={[]} />
          </>
        ) : (
          <div className="empty-state">Select a ticket for detail view.</div>
        )}
      </section>
    </div>
  );
}
