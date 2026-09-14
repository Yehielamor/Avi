import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from './button';
import { ApiError } from '@/lib/api';

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError ? error.message : 'משהו השתבש';
  const retryable = !(error instanceof ApiError) || error.isRetryable;

  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 grid size-11 place-items-center rounded-full bg-danger-subtle text-danger">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <h3 className="text-sm font-medium text-fg">{message}</h3>
      {retryable && onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-5">
          <RotateCw aria-hidden />
          נסה שוב
        </Button>
      ) : null}
    </div>
  );
}
