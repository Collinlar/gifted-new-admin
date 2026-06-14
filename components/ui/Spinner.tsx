export default function Spinner({ text }: { text?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-subtle">
      <svg className="animate-spin w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      {text && <p className="text-sm text-muted">{text}</p>}
    </div>
  );
}
