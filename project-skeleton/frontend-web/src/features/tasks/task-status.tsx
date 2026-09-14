import { Badge } from '@/components/ui/badge';
import type { TaskStatus } from '@/lib/schemas';

/**
 * מקור יחיד לתרגום ולצבע של סטטוס. מיפוי מפוזר ב-JSX הוא איך
 * ש"בטיפול" מופיע בשלושה גוונים בשלושה מסכים.
 */
const STATUS: Record<TaskStatus, { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' }> = {
  NEW: { label: 'חדשה', tone: 'info' },
  ASSIGNED: { label: 'שויכה', tone: 'accent' as 'info' },
  IN_PROGRESS: { label: 'בטיפול', tone: 'warning' },
  CLOSED: { label: 'הושלמה', tone: 'success' },
  CANCELLED: { label: 'בוטלה', tone: 'neutral' },
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const statusLabel = (s: TaskStatus): string => STATUS[s].label;

const PRIORITY: Record<number, { label: string; tone: 'danger' | 'neutral' | 'info' }> = {
  1: { label: 'דחוף', tone: 'danger' },
  2: { label: 'רגיל', tone: 'neutral' },
  3: { label: 'נמוך', tone: 'info' },
};

export function PriorityBadge({ priority }: { priority: number }) {
  const p = PRIORITY[priority] ?? PRIORITY[2]!;
  return (
    <Badge tone={p.tone} dot={priority === 1}>
      {p.label}
    </Badge>
  );
}
