import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../hooks/useAuth";

const defaultUsers = [
  "amy.admin@acme.com",
  "adam.agent@acme.com",
  "alice.customer@acme.com"
];

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(defaultUsers[0]);
  const [password, setPassword] = useState("hashed-password");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="center">
      <div className="card auth-card">
        <h2>Login</h2>
        <p className="muted">Sign in or create a new workspace account.</p>
        <form
          className="auth-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            setLoading(true);
            try {
              await login(email, password);
              navigate("/dashboard");
            } catch (err) {
              if (err instanceof ApiError && err.status === 0) {
                setError(err.message);
              } else {
                setError("Login failed. Check credentials.");
              }
            } finally {
              setLoading(false);
            }
          }}
        >
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} list="seeded-users" />
          <datalist id="seeded-users">
            {defaultUsers.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="warning">{error}</p>}
          <button type="submit" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
        </form>
        <p className="muted">
          New here? <Link to="/signup">Create account</Link>
        </p>
      </div>
    </div>
  );
}
