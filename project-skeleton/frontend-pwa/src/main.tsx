import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider } from '@/lib/auth';
import { queryClient } from '@/lib/query';
import { router } from '@/router';
import './styles/theme.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

/* ---------------------------------------------------------------------------
   רישום ה-service worker.

   `immediate: true` — הרישום מתחיל מיד ולא ממתין ל-load. הקליפה
   צריכה להיכנס למטמון כבר בביקור הראשון, כי הביקור השני עלול
   להיות מהמרתף של הלקוח.

   העדכון מוחל אוטומטית (registerType: 'autoUpdate'), בלי לשאול את
   המשתמש. טכנאי באמצע סגירת משימה לא אמור להכריע בשאלת גרסאות,
   והשינוי נכנס לתוקף בניווט הבא ממילא.
   --------------------------------------------------------------------------- */
registerSW({ immediate: true });
