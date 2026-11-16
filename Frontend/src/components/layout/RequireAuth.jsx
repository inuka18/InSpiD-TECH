import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useRole } from "../../context/RoleContext";

// Gate for the whole app shell: nothing renders without a signed-in user.
// While a stored token is being validated (GET /auth/me) a spinner shows, so a page refresh does not
// bounce a logged-in user through the login screen.
export function RequireAuth() {
  const { isAuthenticated, loading } = useRole();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Checking your session" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <Outlet />;
}
