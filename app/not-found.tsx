import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="text-center">
        <p className="text-6xl font-bold text-primary mb-4">404</p>
        <p className="text-lg font-semibold text-ink mb-1">Page not found</p>
        <p className="text-sm text-muted mb-6">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/dashboard" className="text-sm text-primary hover:underline font-medium">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
