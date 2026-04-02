import { useAuth } from "../hooks/useAuth";
import { AdminDashboard } from "./AdminDashboard";
import { AgentDashboard } from "./AgentDashboard";
import { UserDashboard } from "./UserDashboard";

export function DashboardRouter() {
  const { user } = useAuth();

  if (user?.role === "admin") {
    return <AdminDashboard />;
  }

  if (user?.role === "agent") {
    return <AgentDashboard />;
  }

  return <UserDashboard />;
}
