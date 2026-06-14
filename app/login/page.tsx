"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { setToken } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.email.trim()) return setError("Enter your email address.");
    if (!form.password.trim()) return setError("Enter your password.");
    setLoading(true);
    try {
      const res = await api.post("/admin-login", form);
      if (res.data.success) {
        setToken(res.data.token);
        router.push("/dashboard");
      } else {
        setError(res.data.message || "Login failed. Check your credentials.");
      }
    } catch {
      setError("Could not reach the server. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-sidebar flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand mark */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-lg">G</span>
          </div>
          <div>
            <p className="text-white font-semibold text-lg leading-none">Gifted Admin</p>
            <p className="text-white/40 text-xs mt-0.5">Management Dashboard</p>
          </div>
        </div>

        <div className="bg-white/8 border border-white/12 rounded-2xl p-7 backdrop-blur-sm">
          <h2 className="text-white font-semibold text-lg mb-1">Sign in</h2>
          <p className="text-white/40 text-sm mb-6">Enter your admin credentials</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm text-white/60 font-medium">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="admin@gifted.com"
                className="w-full bg-white/6 border border-white/12 text-white placeholder:text-white/25 rounded-xl px-4 py-3 focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm text-white/60 font-medium">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                className="w-full bg-white/6 border border-white/12 text-white placeholder:text-white/25 rounded-xl px-4 py-3 focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-colors"
              />
            </div>

            {error && (
              <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl py-3 transition-colors disabled:opacity-60 mt-2"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
