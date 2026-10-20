import { useNavigate } from "react-router-dom";
import { LogOut, RefreshCcw, ShieldCheck, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { useRole } from "../../context/RoleContext";

// The account menu in the top bar: who is signed in, and "Log out / switch account".
// (Roles come from the real login now, so there is no role picker any more.)
export function RoleSwitcher() {
  const { currentUser, role, logout } = useRole();
  const navigate = useNavigate();

  if (!currentUser) return null;

  const signOut = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const RoleIcon = role === "pm" ? ShieldCheck : User;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Account menu"
          className="flex items-center gap-2 rounded-full outline-none ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback>{currentUser.initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">{currentUser.name}</span>
            <span className="text-xs text-muted-foreground">{currentUser.title}</span>
            <span className="text-xs text-muted-foreground">{currentUser.email}</span>
            <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-primary">
              <RoleIcon className="h-3 w-3" />
              {role === "pm" ? "Project Manager" : "Team Member"}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} className="gap-2.5">
          <RefreshCcw className="h-4 w-4 text-muted-foreground" />
          Switch account
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={signOut} className="gap-2.5 text-destructive">
          <LogOut className="h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
