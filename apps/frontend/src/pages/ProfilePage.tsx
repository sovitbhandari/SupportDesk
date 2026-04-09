import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { getProfile, updateProfile } from "../api/endpoints";
import { useAuth } from "../hooks/useAuth";
import { applyTheme, type ThemePreference } from "../lib/theme";

export function ProfilePage() {
  const { token, user, setUser } = useAuth();
  const queryClient = useQueryClient();
  const [preferredName, setPreferredName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [theme, setTheme] = useState<ThemePreference>("light");
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile(token!),
    enabled: Boolean(token)
  });

  useEffect(() => {
    const data = profileQuery.data;
    if (!data) return;
    setPreferredName(data.preferred_name ?? data.full_name ?? "");
    setFullName(data.full_name ?? "");
    setEmail(data.email ?? "");
  }, [profileQuery.data]);

  const profileMutation = useMutation({
    mutationFn: (payload: {
      preferredName?: string;
      fullName?: string;
      email?: string;
      preferredTheme?: "light" | "dark";
    }) => updateProfile(token!, payload),
    onSuccess: (data) => {
      setUser({
        userId: user!.userId,
        organizationId: user!.organizationId,
        role: user!.role,
        email: data.email
      });
      queryClient.setQueryData(["profile"], (current: Awaited<ReturnType<typeof getProfile>> | undefined) => {
        if (!current) return current;
        return {
          ...current,
          email: data.email,
          full_name: data.full_name,
          preferred_name: data.preferred_name,
          preferred_theme: data.preferred_theme
        };
      });
      if (data.preferred_theme) {
        setTheme(data.preferred_theme);
        applyTheme(data.preferred_theme);
      }
      setStatus({ type: "success", text: "Settings saved." });
    },
    onError: (error) => {
      setStatus({ type: "error", text: error instanceof Error ? error.message : "Failed to save settings." });
    }
  });

  const sessionRows = useMemo(() => {
    const data = profileQuery.data;
    if (!data) return [];
    const fmt = (value: string | null | undefined) => (value ? new Date(value).toLocaleString() : "N/A");
    return [
      { label: "Current login", value: fmt(data.current_session_created_at) },
      { label: "Last login", value: fmt(data.last_login_at) }
    ];
  }, [profileQuery.data]);

  if (profileQuery.isLoading) {
    return <div className="panel">Loading settings...</div>;
  }

  return (
    <div className="settings-page settings-layout">
      <section className="panel settings-card settings-hero">
        <div className="settings-card-head">
          <h3>Appearance</h3>
          <p className="muted">Choose how the app looks for your account.</p>
        </div>
        <div className="theme-toggle" role="group" aria-label="Theme">
          <button
            type="button"
            className={theme === "light" ? "theme-chip active" : "theme-chip"}
            onClick={() => {
              if (theme === "light") return;
              setTheme("light");
              applyTheme("light");
              profileMutation.mutate({ preferredTheme: "light" });
            }}
            disabled={profileMutation.isPending}
          >
            Light
          </button>
          <button
            type="button"
            className={theme === "dark" ? "theme-chip active" : "theme-chip"}
            onClick={() => {
              if (theme === "dark") return;
              setTheme("dark");
              applyTheme("dark");
              profileMutation.mutate({ preferredTheme: "dark" });
            }}
            disabled={profileMutation.isPending}
          >
            Dark
          </button>
        </div>
      </section>

      <section className="panel settings-card">
        <div className="settings-card-head">
          <h3>Profile</h3>
          <p className="muted">Update your personal information.</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            profileMutation.mutate({
              preferredName: preferredName.trim(),
              fullName: fullName.trim(),
              email: email.trim()
            });
          }}
        >
          <label>Preferred name</label>
          <input name="preferredName" value={preferredName} onChange={(event) => setPreferredName(event.target.value)} required />

          <label>Full name</label>
          <input name="fullName" value={fullName} onChange={(event) => setFullName(event.target.value)} required />

          <label>Email</label>
          <input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />

          <button type="submit" disabled={profileMutation.isPending}>Save profile</button>
        </form>
      </section>

      <section className="panel settings-card">
        <div className="settings-card-head">
          <h3>Session info</h3>
          <p className="muted">Active session metadata from backend login history.</p>
        </div>
        <div className="settings-kv-list">
          {sessionRows.map((row) => (
            <div key={row.label} className="settings-kv-row">
              <span className="settings-kv-key">{row.label}</span>
              <span className="settings-kv-value">{row.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel settings-card">
        <div className="settings-card-head">
          <h3>Workspace info</h3>
          <p className="muted">Read-only organization details.</p>
        </div>
        <div className="settings-kv-list">
          <div className="settings-kv-row">
            <span className="settings-kv-key">Organization name</span>
            <span className="settings-kv-value">{profileQuery.data?.organization_name ?? "N/A"}</span>
          </div>
          <div className="settings-kv-row">
            <span className="settings-kv-key">Organization slug</span>
            <span className="settings-kv-value">{profileQuery.data?.organization_slug ?? "N/A"}</span>
          </div>
          <div className="settings-kv-row">
            <span className="settings-kv-key">Contact email</span>
            <span className="settings-kv-value">{profileQuery.data?.email ?? "N/A"}</span>
          </div>
        </div>
      </section>

      {status && (
        <div className={status.type === "success" ? "settings-banner success" : "settings-banner warning"}>
          {status.text}
        </div>
      )}
    </div>
  );
}
