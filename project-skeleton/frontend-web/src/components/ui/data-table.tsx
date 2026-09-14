import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * טבלה. קיימת כדי שהנגישות (caption, scope) והגלילה האופקית ייעשו
 * נכון פעם אחת. גלילה אופקית של ה-body היא באג — התוכן הרחב גולל
 * בתוך המכל שלו.
 */
export interface Column<T> {
  key: string;
  header: string;
  /** יישור לסוף — למספרים וכסף. */
  numeric?: boolean;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  minWidth = '42rem',
  onRowClick,
}: {
  caption: string;
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  minWidth?: string;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border bg-surface-sunken/60">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'px-4 py-2.5 text-start text-2xs font-medium uppercase tracking-wide text-fg-subtle',
                  c.numeric && 'text-end',
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'transition-colors hover:bg-surface-hover',
                onRowClick && 'cursor-pointer',
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn('px-4 py-3', c.numeric && 'tabular text-end', c.className)}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
