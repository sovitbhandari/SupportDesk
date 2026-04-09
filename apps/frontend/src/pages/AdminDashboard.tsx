import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { assignTicket, listEmployees, listTickets, listUsers, updateEmployee, updateTicketStatus } from "../api/endpoints";
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
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamSuccess, setTeamSuccess] = useState<string | null>(null);

  const ticketsQuery = useQuery({
    queryKey: ["tickets", view],
    queryFn: () => listTickets(token!),
    enabled: Boolean(token),
    refetchInterval: 8000
  });

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => listEmployees(token!),
    enabled: Boolean(token)
  });
  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => listUsers(token!),
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
      setTeamSuccess("Role updated successfully");
      setTeamError(null);
    },
    onError: (error) => {
      setTeamSuccess(null);
      setTeamError(error instanceof Error ? error.message : "Failed to update role");
    }
  });

  const statusMutation = useMutation({
    mutationFn: (payload: { id: string; isActive: boolean }) =>
      updateEmployee(token!, payload.id, { isActive: payload.isActive }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onSuccess: (_, payload) => {
      setTeamSuccess(payload.isActive ? "Employee activated" : "Employee deactivated");
      setTeamError(null);
    },
    onError: (error) => {
      setTeamSuccess(null);
      setTeamError(error instanceof Error ? error.message : "Failed to update status");
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
  const usersById = useMemo(() => {
    const map = new Map<string, { full_name: string; email: string; is_active: boolean }>();
    for (const userItem of usersQuery.data ?? []) {
      map.set(userItem.id, {
        full_name: userItem.full_name,
        email: userItem.email,
        is_active: userItem.is_active
      });
    }
    return map;
  }, [usersQuery.data]);

  const personLabel = (id: string | null | undefined, fallback = "Unassigned") => {
    if (!id) return fallback;
    const person = usersById.get(id);
    if (!person) return "Unknown user";
    return `${person.full_name} (${person.email})${person.is_active ? "" : " - inactive"}`;
  };

  const queueTickets = useMemo(() => {
    const all = ticketsQuery.data ?? [];
    if (view === "open") {
      return all.filter((t) => t.status === "open" || t.status === "pending");
    }
    return all.filter((t) => t.status === "resolved" || t.status === "closed");
  }, [ticketsQuery.data, view]);

  const selectedTicket = queueTickets.find((t) => t.id === selectedTicketId) ?? null;

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
              <small>Requester: {personLabel(ticket.requester_id, "Unknown requester")}</small>
              <small>Assigned: {personLabel(ticket.active_assignment_agent_id)}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="ticket-detail-pane">
        {selectedTicket ? (
          <>
            <div className="pane-header admin-detail-head">
              <div>
                <h3>{selectedTicket.subject}</h3>
                <p className="muted">Ticket details and action controls</p>
              </div>
              <span className="pill">{selectedTicket.priority}</span>
            </div>

            <div className="panel ticket-meta-panel" style={{ marginBottom: 10 }}>
              <div className="ticket-meta-grid">
                <div>
                  <small className="muted">Status</small>
                  <p className="ticket-meta-value">
                    <span className={`status ${selectedTicket.status}`}>{selectedTicket.status}</span>
                  </p>
                </div>
                <div>
                  <small className="muted">Priority</small>
                  <p className="ticket-meta-value">{selectedTicket.priority}</p>
                </div>
                <div>
                  <small className="muted">Requester</small>
                  <p className="ticket-meta-value">{personLabel(selectedTicket.requester_id, "Unknown requester")}</p>
                </div>
                <div>
                  <small className="muted">Assigned agent</small>
                  <p className="ticket-meta-value">{personLabel(selectedTicket.active_assignment_agent_id)}</p>
                </div>
              </div>
            </div>

            <div className="admin-action-row" style={{ marginBottom: 10 }}>
              <div className="panel">
                <h4>Assignment</h4>
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
                <div className="panel">
                  <h4>Ticket state</h4>
                  <p className="muted" style={{ marginBottom: 10 }}>
                    Mark this ticket as solved when support work is complete.
                  </p>
                  <button onClick={() => resolveMutation.mutate(selectedTicket.id)}>
                    Move to solved
                  </button>
                </div>
              )}
            </div>

            <ChatPanel ticket={selectedTicket} incomingMessages={[]} />

            <div className="panel org-access-panel" style={{ marginTop: 12 }}>
              <h4>Organization access management</h4>
              <p className="muted" style={{ marginBottom: 10 }}>
                This section applies to workspace-level access, not just this ticket.
              </p>
              <div className="employee-head">
                <span>Employee</span>
                <span>Role</span>
                <span>Access</span>
              </div>
              {(employeesQuery.data ?? []).map((employee) => {
                const isSelf = employee.id === user?.userId;
                return (
                  <div key={employee.id} className="employee-row">
                    <div className="employee-meta">
                      <strong>{employee.full_name}</strong>
                      <small className="muted">{employee.email}</small>
                      {isSelf && <small className="muted">Current session</small>}
                    </div>
                    <select
                      aria-label={`Role for ${employee.full_name}`}
                      value={employee.role}
                      disabled={roleMutation.isPending}
                      onChange={(e) => {
                        const role = e.target.value as "admin" | "agent" | "customer";
                        if (role === employee.role) return;
                        roleMutation.mutate({ id: employee.id, role });
                      }}
                    >
                      <option value="admin">Admin</option>
                      <option value="agent">Agent</option>
                      <option value="customer">Customer</option>
                    </select>
                    <select
                      aria-label={`Status for ${employee.full_name}`}
                      value={employee.is_active ? "active" : "inactive"}
                      disabled={statusMutation.isPending}
                      onChange={(e) => {
                        const isActive = e.target.value === "active";
                        if (isActive === employee.is_active) return;
                        statusMutation.mutate({ id: employee.id, isActive });
                      }}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                );
              })}
              {teamError && <p className="warning">{teamError}</p>}
              {teamSuccess && <p className="success">{teamSuccess}</p>}
            </div>
          </>
        ) : (
          <div className="empty-state">Select a ticket for detail view.</div>
        )}
      </section>
    </div>
  );
}
