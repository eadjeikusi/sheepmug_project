import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';

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

      toast.success('Request sent. A leader will approve it in the app.');
      setFirstName('');
      setLastName('');
      setDob('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
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
              id="firstName"
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              required
            />
          </div>
          <div>
            <label htmlFor="dob" className="block text-xs font-medium text-slate-700">
              Date of birth
            </label>
            <input
              id="dob"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Sending…' : 'Request to join'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default JoinGroupPage;
