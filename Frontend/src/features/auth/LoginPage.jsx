import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ShieldCheck, User, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Logo } from "../../components/layout/Logo";
import { useRole } from "../../context/RoleContext";

// Demo accounts exist in the seeded database. Only the EMAIL is filled in; the password is never in the code.
const DEMO_PM_EMAIL = "pm.ret@inspid.test";
const DEMO_MEMBER_EMAIL = "developer.ret@inspid.test";

export function LoginPage() {
  const { login, isAuthenticated, loading } = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && isAuthenticated) {
    return <Navigate to={location.state?.from || "/"} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(location.state?.from || "/", { replace: true });
    } catch (err) {
      setError(err.message || "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  const fillEmail = (value) => {
    setEmail(value);
    setError("");
    document.getElementById("password")?.focus();
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* Subtle branded backdrop */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, hsl(var(--primary) / 0.16), transparent), radial-gradient(ellipse 60% 50% at 100% 100%, hsl(var(--primary) / 0.10), transparent)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.4] [background-size:32px_32px]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 30%, black, transparent)",
        }}
      />

      <div className="relative w-full max-w-sm animate-fade-in">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo imgClassName="h-8" />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to your InSpiD-TECH workspace</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-7">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@inspid.test"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-status-dropped-fg/30 bg-status-dropped-bg px-3 py-2 text-sm text-status-dropped-fg"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Log in
              {!submitting && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Demo accounts</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-2.5">
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start gap-3 py-5"
              onClick={() => fillEmail(DEMO_PM_EMAIL)}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <span className="flex flex-col items-start">
                <span className="text-sm font-semibold text-foreground">Fill demo PM email</span>
                <span className="text-xs text-muted-foreground">{DEMO_PM_EMAIL}</span>
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start gap-3 py-5"
              onClick={() => fillEmail(DEMO_MEMBER_EMAIL)}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <User className="h-4 w-4" />
              </span>
              <span className="flex flex-col items-start">
                <span className="text-sm font-semibold text-foreground">Fill demo member email</span>
                <span className="text-xs text-muted-foreground">{DEMO_MEMBER_EMAIL}</span>
              </span>
            </Button>
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            The buttons only fill in the email. Use the demo password from your own setup.
          </p>
        </div>
      </div>
    </div>
  );
}
