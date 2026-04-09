import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { playgroundCreateTicket, me } from "../api/endpoints";
import { setAccessToken, ApiError } from "../api/client";
import { useAuth } from "../hooks/useAuth";

export function CustomerPlaygroundPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="center">
      <div className="card auth-card">
        <h2>Customer Playground</h2>
        <p className="muted">Create a ticket without going through full account setup.</p>
        <form
          className="auth-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            setLoading(true);
            const form = new FormData(event.currentTarget);
            try {
              const result = await playgroundCreateTicket({
                name: String(form.get("name") ?? "").trim(),
                email: String(form.get("email") ?? "").trim(),
                subject: String(form.get("subject") ?? "").trim(),
                description: String(form.get("description") ?? "").trim(),
                companySlug: String(form.get("companySlug") ?? "").trim() || undefined
              });
              setAccessToken(result.token);
              const profile = await me(result.token);
              setUser(profile.user);
              navigate("/dashboard");
            } catch (err) {
              if (err instanceof ApiError) {
                setError(err.message);
              } else {
                setError("Failed to create playground ticket");
              }
            } finally {
              setLoading(false);
            }
          }}
        >
          <label>Name</label>
          <input name="name" required />
          <label>Email</label>
          <input type="email" name="email" required />
          <label>Subject</label>
          <input name="subject" required />
          <label>Company slug</label>
          <input name="companySlug" defaultValue="acme" />
          <label>Description</label>
          <textarea name="description" required rows={4} />
          {error && <p className="warning">{error}</p>}
          <button type="submit" disabled={loading}>{loading ? "Creating..." : "Create ticket quickly"}</button>
        </form>
      </div>
    </div>
  );
}
