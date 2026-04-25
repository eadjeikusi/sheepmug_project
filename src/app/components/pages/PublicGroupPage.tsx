import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Calendar, Heart, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { capitalizeSentencesForUi } from '@/utils/sentenceCaseDisplay';
import { formatEventRangeLabel, formatCalendarCountdown } from '@/utils/dateDisplayFormat';

type PublicCustomFieldRow = {
  field_key: string;
  label: string;
  field_type: string;
  value: unknown;
};

interface PublicGroupEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  cover_image_url: string | null;
  program_outline: string | null;
  public_custom_fields?: PublicCustomFieldRow[];
}

interface PublicGroupData {
  id: string;
  name: string;
  description: string | null;
  group_type: string | null;
  cover_image_url: string | null;
  announcements_content: string | null;
  program_outline_content: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  public_link_slug: string | null;
  leader_name: string | null;
  join_link_enabled: boolean | null;
  join_invite_token?: string | null;
  member_count?: number;
  events?: PublicGroupEvent[];
  public_group_custom_fields?: PublicCustomFieldRow[];
}

function formatPublicCustomValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function formatEventWhen(start: string, end: string | null): string {
  return formatEventRangeLabel(start, end);
}

const PublicGroupPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [groupData, setGroupData] = useState<PublicGroupData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [coverLightboxOpen, setCoverLightboxOpen] = useState(false);

  const joinHref = useMemo(() => {
    if (!groupData) return '#';
    return `/join-group/${groupData.join_invite_token || groupData.id}`;
  }, [groupData]);

  const publicPageUrl = useMemo(() => {
    if (typeof window === 'undefined' || !slug) return '';
    return `${window.location.origin}/public/groups/${slug}`;
  }, [slug]);

  useEffect(() => {
    setCoverLightboxOpen(false);
  }, [slug]);

  useEffect(() => {
    if (!slug?.trim()) {
      setError('Missing group slug.');
      setLoading(false);
      return;
    }

    const fetchPublicGroup = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/public/groups/${encodeURIComponent(slug.trim())}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error((payload as { error?: string }).error || 'Failed to load this page.');
        }
        setGroupData(payload as PublicGroupData);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Something went wrong';
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    };

    void fetchPublicGroup();
  }, [slug]);

  useEffect(() => {
    if (!coverLightboxOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCoverLightboxOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [coverLightboxOpen]);

  const copyShare = async () => {
    if (!publicPageUrl) return;
    try {
      await navigator.clipboard.writeText(publicPageUrl);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy link');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-dvh w-full min-w-0 flex-col items-center justify-center bg-slate-50 text-slate-600">
        <p className="text-sm font-medium">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-dvh w-full min-w-0 flex-col items-center justify-center bg-slate-50 px-4">
        <p className="text-center text-red-600">{error}</p>
        <Link to="/" className="mt-6 text-sm font-semibold text-blue-600 hover:text-blue-800">
          Go home
        </Link>
      </div>
    );
  }

  if (!groupData) {
    return (
      <div className="flex min-h-dvh w-full min-w-0 flex-col items-center justify-center bg-slate-50 px-4 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">This public ministry page is not available.</p>
        <Link to="/" className="mt-6 text-sm font-semibold text-blue-600 hover:text-blue-800">
          Go home
        </Link>
      </div>
    );
  }

  const memberCount = groupData.member_count ?? 0;
  const events = groupData.events ?? [];
  const tabBase =
    'rounded-lg border-0 bg-transparent px-3 py-2 text-sm font-medium text-slate-500 shadow-none data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm';

  return (
    <div className="min-h-dvh w-full min-w-0 bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <nav className="flex min-w-0 items-center gap-1 text-xs text-slate-500">
            <span className="shrink-0">Public ministry</span>
            <span className="text-slate-300">/</span>
            <span className="min-w-0 truncate font-semibold text-slate-700">{groupData.name}</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Hero — cover (rounded, course-style) */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-200 shadow-sm ring-1 ring-black/5">
          {groupData.cover_image_url?.trim() ? (
            <button
              type="button"
              onClick={() => setCoverLightboxOpen(true)}
              className="group relative block aspect-[21/9] min-h-[160px] w-full cursor-zoom-in sm:aspect-[2/1] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              aria-label={`View ${groupData.name} cover photo full screen`}
            >
              <img
                src={groupData.cover_image_url.trim()}
                alt=""
                className="h-full w-full object-cover transition duration-200 group-hover:brightness-[0.97]"
              />
              <span className="pointer-events-none absolute bottom-2 right-2 rounded-lg bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white opacity-0 shadow-sm transition-opacity duration-200 group-hover:opacity-100 sm:opacity-90">
                Tap to view full screen
              </span>
            </button>
          ) : (
            <div className="flex aspect-[21/9] min-h-[160px] w-full items-center justify-center bg-gradient-to-br from-blue-600 to-blue-700 sm:aspect-[2/1]">
              <span className="text-sm font-medium text-white/90">No cover photo yet</span>
            </div>
          )}
        </div>

        {/* Title */}
        <h1 className="mt-6 text-2xl font-bold leading-tight tracking-tight text-slate-900 sm:text-3xl">
          {groupData.name}
        </h1>

        {/* Tags + actions */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              {memberCount} member{memberCount === 1 ? '' : 's'}
            </span>
            {groupData.group_type?.trim() ? (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {groupData.group_type.trim()}
              </span>
            ) : null}
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              {events.length} event{events.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {groupData.join_link_enabled ? (
              <a
                href={joinHref}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} />
                Request to join
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => void copyShare()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50"
            >
              <Heart className="h-4 w-4 text-slate-500" strokeWidth={2} />
              Share link
            </button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="mt-8">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl bg-slate-100/90 p-1">
            <TabsTrigger value="overview" className={tabBase}>
              Overview
            </TabsTrigger>
            <TabsTrigger value="join" className={tabBase}>
              Join
            </TabsTrigger>
            <TabsTrigger value="events" className={tabBase}>
              Events
            </TabsTrigger>
            <TabsTrigger value="leaders" className={tabBase}>
              Leaders
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6 outline-none">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
              {groupData.description?.trim() ? (
                <section className="mb-8">
                  <h2 className="text-xs font-semibold text-slate-400">About</h2>
                  <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-slate-700">
                    {capitalizeSentencesForUi(groupData.description.trim())}
                  </p>
                </section>
              ) : (
                <p className="mb-8 text-sm text-slate-500">No description has been added yet.</p>
              )}

              {groupData.public_group_custom_fields && groupData.public_group_custom_fields.length > 0 ? (
                <section className="mb-8">
                  <h2 className="text-xs font-semibold text-slate-400">More About This Ministry</h2>
                  <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {groupData.public_group_custom_fields.map((row) => (
                      <div key={row.field_key}>
                        <dt className="text-xs text-slate-500">{row.label}</dt>
                        <dd className="mt-0.5 text-sm font-medium text-slate-900 break-words">
                          {formatPublicCustomValue(row.value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}

              {groupData.announcements_content?.trim() ? (
                <section className="mb-8">
                  <h2 className="text-xs font-semibold text-slate-400">Announcements</h2>
                  <div
                    className="prose prose-slate mt-2 max-w-none prose-p:text-slate-700"
                    dangerouslySetInnerHTML={{ __html: groupData.announcements_content }}
                  />
                </section>
              ) : null}

              {groupData.program_outline_content?.trim() ? (
                <section className="mb-8">
                  <h2 className="text-xs font-semibold text-slate-400">Program</h2>
                  <div
                    className="prose prose-slate mt-2 max-w-none prose-p:text-slate-700"
                    dangerouslySetInnerHTML={{ __html: groupData.program_outline_content }}
                  />
                </section>
              ) : null}

              {groupData.contact_email || groupData.contact_phone ? (
                <section>
                  <h2 className="text-xs font-semibold text-slate-400">Contact</h2>
                  <div className="mt-2 space-y-1 text-sm text-slate-700">
                    {groupData.contact_email?.trim() ? (
                      <p>
                        Email:{' '}
                        <a className="font-medium text-blue-600 hover:underline" href={`mailto:${groupData.contact_email}`}>
                          {groupData.contact_email}
                        </a>
                      </p>
                    ) : null}
                    {groupData.contact_phone?.trim() ? <p>Phone: {groupData.contact_phone}</p> : null}
                  </div>
                </section>
              ) : null}
            </div>
          </TabsContent>

          <TabsContent value="join" className="mt-6 outline-none">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
              {groupData.join_link_enabled ? (
                <>
                  <p className="text-sm leading-relaxed text-slate-600">
                    You can send a join request with your details. The ministry team will review your request.
                  </p>
                  <a
                    href={joinHref}
                    className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 sm:w-auto"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.5} />
                    Start join request
                  </a>
                  <p className="mt-4 text-xs text-slate-400">
                    Tip: use <span className="font-medium text-slate-600">Share link</span> above to invite others.
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-600">
                  Online join requests are not open for this ministry yet. Use the contact information on the
                  Overview tab if you need to get in touch.
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="events" className="mt-6 outline-none">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
              {events.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No events are linked to this ministry yet. Events assigned to this group in your calendar will
                  appear here.
                </p>
              ) : (
                <ul className="space-y-6">
                  {events.map((ev) => {
                    const isPast = new Date(ev.start_time).getTime() < Date.now();
                    const evCd = formatCalendarCountdown(ev.start_time);
                    return (
                      <li
                        key={ev.id}
                        className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/40 shadow-sm transition-colors hover:border-slate-200"
                      >
                        <div className="aspect-[2/1] max-h-52 w-full bg-slate-200 sm:aspect-[21/9] sm:max-h-none">
                          {ev.cover_image_url?.trim() ? (
                            <img
                              src={ev.cover_image_url.trim()}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full min-h-[140px] w-full items-center justify-center bg-gradient-to-br from-blue-100 to-blue-100">
                              <Calendar className="h-10 w-10 text-blue-300" aria-hidden />
                            </div>
                          )}
                        </div>
                        <div className="p-4 sm:p-5">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-semibold leading-snug text-slate-900">{ev.title}</p>
                            {isPast ? (
                              <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                Past
                              </span>
                            ) : (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                                Upcoming
                              </span>
                            )}
                          </div>
                          <div className="mt-2 space-y-0.5">
                            <p className="flex items-center gap-1.5 text-sm text-slate-600">
                              <Calendar className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                              {formatEventWhen(ev.start_time, ev.end_time)}
                            </p>
                            {evCd ? <p className="pl-5 text-[11px] text-slate-500">{evCd}</p> : null}
                          </div>
                          {ev.public_custom_fields && ev.public_custom_fields.length > 0 ? (
                            <dl className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-200/80 pt-3 sm:grid-cols-2">
                              {ev.public_custom_fields.map((row) => (
                                <div key={row.field_key}>
                                  <dt className="text-[11px] font-medium text-slate-500">
                                    {row.label}
                                  </dt>
                                  <dd className="mt-0.5 text-sm text-slate-800 break-words">
                                    {formatPublicCustomValue(row.value)}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ) : null}
                          {ev.program_outline?.trim() ? (
                            <div
                              className="prose prose-sm prose-slate mt-4 max-w-none border-t border-slate-200/80 pt-4 prose-p:text-slate-700 prose-headings:text-slate-900"
                              dangerouslySetInnerHTML={{ __html: ev.program_outline }}
                            />
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="leaders" className="mt-6 outline-none">
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 shadow-sm sm:p-7">
              <p className="text-sm text-slate-600">
                Leader profiles will appear here in a future update. You&apos;re seeing a preview of the layout
                only.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-8 sm:justify-start">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex flex-col items-center gap-3">
                    <div className="h-20 w-20 rounded-full border-2 border-dashed border-slate-200 bg-slate-50" />
                    <div className="space-y-1.5 text-center">
                      <div className="mx-auto h-2.5 w-24 rounded-full bg-slate-200" />
                      <div className="mx-auto h-2 w-16 rounded-full bg-slate-100" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mt-12 border-t border-slate-200 bg-white py-8 text-center text-xs text-slate-500">
        <p>
          &copy; {new Date().getFullYear()} {groupData.name}
        </p>
      </footer>

      {coverLightboxOpen && groupData.cover_image_url?.trim() ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Cover photo full screen"
          onClick={() => setCoverLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={() => setCoverLightboxOpen(false)}
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Close"
          >
            <X className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <img
            src={groupData.cover_image_url.trim()}
            alt=""
            className="max-h-[min(92vh,100%)] max-w-full object-contain shadow-2xl"
            onClick={(ev) => ev.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
};

export default PublicGroupPage;
