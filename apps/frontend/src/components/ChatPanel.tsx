import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listMessages, sendMessage } from "../api/endpoints";
import { ApiError } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import type { Message, Ticket } from "../types";

type Props = {
  ticket: Ticket | null;
  incomingMessages: Message[];
};

export function ChatPanel({ ticket, incomingMessages }: Props) {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [warning, setWarning] = useState<string | null>(null);

  const key = ["messages", ticket?.id];

  const messagesQuery = useQuery({
    queryKey: key,
    queryFn: () => listMessages(token!, ticket!.id),
    enabled: Boolean(token && ticket?.id)
  });

  const combinedMessages = useMemo(() => {
    const base = messagesQuery.data ?? [];
    const map = new Map<string, Message>();
    for (const msg of [...base, ...incomingMessages]) {
      map.set(msg.id, msg);
    }
    return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [messagesQuery.data, incomingMessages]);

  const sendMutation = useMutation({
    mutationFn: async (body: string) => sendMessage(token!, ticket!.id, body),
    onMutate: async (body) => {
      setWarning(null);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Message[]>(key) ?? [];

      const optimistic: Message = {
        id: `optimistic-${Date.now()}`,
        organization_id: ticket!.organization_id,
        ticket_id: ticket!.id,
        author_id: user!.userId,
        body,
        created_at: new Date().toISOString()
      };

      queryClient.setQueryData<Message[]>(key, [...previous, optimistic]);
      return { previous };
    },
    onError: (error, _body, context) => {
      queryClient.setQueryData(key, context?.previous ?? []);
      const message = error instanceof ApiError ? `${error.message} (${error.status})` : "Message send failed";
      setWarning(message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  });

  if (!ticket) {
    return <div className="panel">Pick a ticket to open chat.</div>;
  }

  return (
    <div className="panel">
      <h3>Chat: {ticket.subject}</h3>
      <div className="chat-log">
        {combinedMessages.map((message) => (
          <div key={message.id} className={message.author_id === user?.userId ? "msg mine" : "msg"}>
            <div className="msg-content">
              <strong className="msg-author">{message.author_id === user?.userId ? "You" : "Agent"}</strong>
              <span>{message.body}</span>
            </div>
            <small>{new Date(message.created_at).toLocaleTimeString()}</small>
          </div>
        ))}
      </div>
      {warning && <p className="warning">{warning}</p>}
      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim() || sendMutation.isPending) {
            return;
          }
          sendMutation.mutate(draft.trim());
          setDraft("");
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a message" />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
