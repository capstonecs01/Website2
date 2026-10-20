import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getUser } from "./auth";

// Reads the stored session and guards a page by role.
// - no session      -> redirect to /login
// - wrong role       -> redirect to that role's own dashboard
// Returns the user once confirmed, or null while the redirect check runs.
export function useAuthUser(requiredRole) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const stored = getUser();
    if (!stored) {
      navigate("/login");
      return;
    }
    if (requiredRole && stored.role !== requiredRole) {
      navigate(stored.role === "company" ? "/dashboard/company" : "/dashboard/student");
      return;
    }
    setUser(stored);
  }, [navigate, requiredRole]);

  return user;
}
