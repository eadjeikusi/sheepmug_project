import { toast } from 'sonner';

/** Call after a bulk SMS row is saved successfully. Hubtel delivery is not wired yet. */
export function notifyHubtelSmsPending(): void {
  toast.warning(
    'Message saved. Bulk SMS via Hubtel is not connected yet — implement the API to deliver messages.',
    { duration: 9000 },
  );
}
