import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { DatePickerField } from '@/components/datetime';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PublicJoinGroupData {
  id: string;
  name: string;
}

const JoinGroupPage: React.FC = () => {
  const { groupId } = useParams<{ groupId: string }>();
  const [groupData, setGroupData] = useState<PublicJoinGroupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const firstNameInputRef = useRef<HTMLInputElement>(null);

  const dobMaxDate = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  useEffect(() => {
    const fetchJoinGroup = async () => {
      setLoading(true);
      setError(null);
      if (!groupId?.trim()) {
        setError('Invalid join link.');
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/public/join-group/${encodeURIComponent(groupId.trim())}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error((payload as { error?: string }).error || 'Could not load this group.');
        }
        setGroupData(payload as PublicJoinGroupData);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Something went wrong';
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    };
    void fetchJoinGroup();
  }, [groupId]);

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedGroupId = groupData?.id;
    if (!resolvedGroupId) {
      toast.error('Group could not be loaded. Refresh and try again.');
      return;
    }

    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn || !ln || !dob) {
      toast.error('Enter your first name, last name, and date of birth.');
      return;
    }

    if (
      !window.confirm(
        'Send this join request? Your first name, last name, and date of birth must match the church directory.',
      )
    ) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/group-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: resolvedGroupId,
          first_name: fn,
          last_name: ln,
          dob,
        }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((body as { error?: string }).error || 'Failed to submit join request');
      }

      setFirstName('');
      setLastName('');
      setDob('');
      setSuccessOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitAnother = () => {
    setSuccessOpen(false);
    window.setTimeout(() => firstNameInputRef.current?.focus(), 100);
  };

  const handleSuccessDone = () => {
    setSuccessOpen(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100/90 p-4">
        <p className="text-sm text-slate-600">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100/90 p-4">
        <p className="max-w-sm text-center text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!groupData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100/90 p-4">
        <p className="text-sm text-slate-600">This join link is not valid.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100/90 p-4">
      <div
        role="dialog"
        aria-labelledby="join-dialog-title"
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h1 id="join-dialog-title" className="text-lg font-semibold text-slate-900">
          Join {groupData.name}
        </h1>
        <p className="mt-2 text-xs text-slate-500">
          Must match your church directory (first name, last name, date of birth). A leader will approve your
          request.
        </p>

        <form onSubmit={handleSubmitRequest} className="mt-5 space-y-4">
          <div>
            <label htmlFor="firstName" className="block text-xs font-medium text-slate-700">
              First name
            </label>
            <input
              ref={firstNameInputRef}
              id="firstName"
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block text-xs font-medium text-slate-700">
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label htmlFor="dob" className="block text-xs font-medium text-slate-700">
              Date of birth
            </label>
            <DatePickerField
              id="dob"
              value={dob}
              onChange={setDob}
              placeholder="Date of birth"
              maxDate={dobMaxDate}
              className="mt-1"
              triggerClassName="h-auto min-h-[38px] rounded-lg border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-none focus-visible:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Sending…' : 'Request to join'}
          </button>
        </form>

        <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
          <DialogContent className="sm:max-w-md" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Request submitted</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-3 text-sm text-slate-600">
                  <p>Your join request was sent. A leader will review it in the app when they are ready.</p>
                  <p>Would you like to submit another request?</p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-2">
              <button
                type="button"
                onClick={handleSuccessDone}
                className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50"
              >
                No, done
              </button>
              <button
                type="button"
                onClick={handleSubmitAnother}
                className="inline-flex h-9 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
              >
                Yes, submit another
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default JoinGroupPage;
