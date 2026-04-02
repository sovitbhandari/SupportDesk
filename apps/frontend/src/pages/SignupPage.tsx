import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../hooks/useAuth";

export function SignupPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="center card">
      <h2>Create your support workspace</h2>
      <p className="muted">Create your profile and organization to start using Zendesk Lite.</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setLoading(true);

          const form = new FormData(event.currentTarget);
          const fullName = String(form.get("fullName") ?? "").trim();
          const email = String(form.get("email") ?? "").trim();
          const password = String(form.get("password") ?? "").trim();
          const organizationName = String(form.get("organizationName") ?? "").trim();
          const organizationSlug = String(form.get("organizationSlug") ?? "").trim();

          try {
            await register({
              fullName,
              email,
              password,
              organizationName,
              organizationSlug: organizationSlug || undefined
            });
            navigate("/dashboard");
          } catch (error) {
            if (error instanceof ApiError) {
              setError(`Signup failed: ${error.message}`);
            } else {
              setError("Signup failed. Try again.");
            }
          } finally {
            setLoading(false);
          }
        }}
      >
        <label>Full name</label>
        <input name="fullName" required />

        <label>Email</label>
        <input name="email" type="email" required />

        <label>Password</label>
        <input name="password" type="password" minLength={8} required />

        <label>Organization name</label>
        <input name="organizationName" required />

        <label>Organization slug (optional)</label>
        <input name="organizationSlug" placeholder="my-company" pattern="[a-z0-9-]+" />

        {error && <p className="warning">{error}</p>}
        <button type="submit" disabled={loading}>{loading ? "Creating..." : "Create account"}</button>
      </form>
    </div>
  );
}
