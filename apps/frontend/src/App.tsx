import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { DashboardRouter } from "./pages/DashboardRouter";
import { ViewsPage } from "./pages/ViewsPage";
import { TicketsPage } from "./pages/TicketsPage";
import { CustomersPage } from "./pages/CustomersPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { ProfilePage } from "./pages/ProfilePage";
import { UnauthorizedPage } from "./pages/UnauthorizedPage";
import { CustomerPlaygroundPage } from "./pages/CustomerPlaygroundPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/playground" element={<CustomerPlaygroundPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardRouter />} />
        <Route path="/views" element={<ViewsPage />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/settings/profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/views" replace />} />
    </Routes>
  );
}
