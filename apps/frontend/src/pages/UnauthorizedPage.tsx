import { Link } from "react-router-dom";

export function UnauthorizedPage() {
  return (
    <div className="center card">
      <h2>Unauthorized</h2>
      <p className="muted">You do not have permission to access this page.</p>
      <Link to="/dashboard">Back to dashboard</Link>
    </div>
  );
}
