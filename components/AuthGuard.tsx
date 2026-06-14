"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import Spinner from "@/components/ui/Spinner";

type AuthStatus = "checking" | "authed" | "unauthed";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>("checking");

  useEffect(() => {
    const authed = isAuthenticated();
    if (!authed) {
      setStatus("unauthed");
      router.replace("/login");
      return;
    }
    setStatus("authed");
  }, [router]);

  // Same markup on server and first client paint — avoids hydration mismatch.
  if (status === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <Spinner text="Checking access..." />
      </div>
    );
  }

  if (status === "unauthed") return null;

  return <>{children}</>;
}
