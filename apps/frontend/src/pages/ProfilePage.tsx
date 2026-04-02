import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getProfile, updatePassword, updateProfile } from "../api/endpoints";
import { useAuth } from "../hooks/useAuth";

export function ProfilePage() {
  const { token, user, setUser } = useAuth();
  const [message, setMessage] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile(token!),
    enabled: Boolean(token)
  });

  const profileMutation = useMutation({
    mutationFn: (payload: { fullName?: string; email?: string }) => updateProfile(token!, payload),
    onSuccess: (data) => {
      setUser({
        userId: user!.userId,
        organizationId: user!.organizationId,
        role: user!.role,
        email: data.email
      });
      setMessage("Profile updated");
    }
  });

  const passwordMutation = useMutation({
    mutationFn: (payload: { currentPassword: string; newPassword: string }) => updatePassword(token!, payload),
    onSuccess: () => setMessage("Password changed successfully")
  });

  return (
    <div className="settings-page">
      <section className="panel">
        <h3>Profile</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            profileMutation.mutate({
              fullName: String(form.get("fullName") ?? "").trim(),
              email: String(form.get("email") ?? "").trim()
            });
          }}
        >
          <label>Full name</label>
          <input name="fullName" defaultValue={profileQuery.data?.full_name ?? ""} required />

          <label>Email</label>
          <input name="email" type="email" defaultValue={profileQuery.data?.email ?? ""} required />

          <button type="submit" disabled={profileMutation.isPending}>Save profile</button>
        </form>
      </section>

      <section className="panel">
        <h3>Security</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            passwordMutation.mutate({
              currentPassword: String(form.get("currentPassword") ?? "").trim(),
              newPassword: String(form.get("newPassword") ?? "").trim()
            });
            (event.currentTarget as HTMLFormElement).reset();
          }}
        >
          <label>Current password</label>
          <input name="currentPassword" type="password" minLength={8} required />

          <label>New password</label>
          <input name="newPassword" type="password" minLength={8} required />

          <button type="submit" disabled={passwordMutation.isPending}>Change password</button>
        </form>
      </section>

      {message && <p className="success">{message}</p>}
    </div>
  );
}
