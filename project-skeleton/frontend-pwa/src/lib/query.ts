import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // נתוני עבודה משתנים תוך כדי — חצי דקה זה האיזון בין רענון
      // לבין הבהוב מיותר של המסך.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // אין טעם לנסות שוב 401/403/404 — התשובה לא תשתנה.
        if (error instanceof ApiError && !error.isRetryable) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});
