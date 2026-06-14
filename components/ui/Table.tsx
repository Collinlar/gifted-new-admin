interface Column<T> {
  key: string;
  header: string;
  render?: (row: T, index: number) => React.ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  emptyMessage?: string;
}

export default function Table<T extends Record<string, unknown>>({ columns, data, emptyMessage = "No records found" }: Props<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th key={col.key} className="text-left px-4 py-3 text-muted font-medium whitespace-nowrap">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center py-12 text-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-surface/50 transition-colors">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-ink">
                    {col.render ? col.render(row, i) : String(row[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
