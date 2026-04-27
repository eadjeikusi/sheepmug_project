import { useCallback, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Camera,
  Heart,
  Loader2,
  Monitor,
  Pencil,
  Smartphone,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { compressImageForUpload, MEMBER_PROFILE_PHOTO_OPTIONS } from '../../utils/compressImageForUpload';

const IOS_STORE_URL = String(import.meta.env.VITE_IOS_APP_URL || '').trim();
const ANDROID_STORE_URL = String(import.meta.env.VITE_ANDROID_APP_URL || '').trim();
const DESKTOP_URL = String(import.meta.env.VITE_DESKTOP_APP_URL || '').trim();

const APP_STORE_BADGE =
  'https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/en-us?size=250x83';
const PLAY_STORE_BADGE =
  'https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png';

type StepKey = 'welcome' | 'photo' | 'members' | 'attendance' | 'apps';

export function CmsOnboardingModal() {
  const { user, token, refreshUser } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [finishing, setFinishing] = useState(false);

  /** Fixed when the modal opens so removing `photo` from the list does not shift steps mid-tour. */
  const [tourIncludePhoto] = useState(() => !Boolean(String(user?.profile_image ?? '').trim()));

  const steps = useMemo(() => {
    const s: StepKey[] = ['welcome'];
    if (tourIncludePhoto) s.push('photo');
    s.push('members', 'attendance', 'apps');
    return s;
  }, [tourIncludePhoto]);

  const current = steps[step] ?? 'welcome';
  const orgLabel =
    String(user?.organization_name ?? '').trim() ||
    (user?.organization && typeof user.organization === 'object' && 'name' in user.organization
      ? String((user.organization as { name?: string }).name ?? '').trim()
      : '');
  const firstName = String(user?.first_name ?? '').trim() || 'there';

  const finish = useCallback(async () => {
    if (!token) return;
    setFinishing(true);
    try {
      const res = await fetch('/api/auth/complete-cms-onboarding', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const raw = await res.text().catch(() => '');
      const data = (() => {
        if (!raw) return {};
        try {
          return JSON.parse(raw) as any;
        } catch {
          return {};
        }
      })();
      if (!res.ok) {
        const msg =
          typeof data?.error === 'string'
            ? data.error
            : raw && raw.trim()
              ? raw.trim()
              : `Could not save onboarding status (${res.status})`;
        throw new Error(msg);
      }
      await refreshUser();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setFinishing(false);
    }
  }, [token, refreshUser]);

  const goNext = () => {
    if (step < steps.length - 1) setStep((s) => s + 1);
  };

  const goBack = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  const pickPhoto = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !token) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    setUploading(true);
    try {
      const optimized = await compressImageForUpload(file, MEMBER_PROFILE_PHOTO_OPTIONS);
      const fd = new FormData();
      fd.append('image', optimized);
      const up = await fetch('/api/upload-image', { method: 'POST', body: fd });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(typeof upData?.error === 'string' ? upData.error : 'Upload failed');
      const url = upData.url as string;
      if (!url) throw new Error('No image URL returned');

      const patchRes = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ profile_image: url }),
      });
      const patchData = await patchRes.json().catch(() => ({}));
      if (!patchRes.ok) {
        throw new Error(typeof patchData?.error === 'string' ? patchData.error : 'Failed to save photo');
      }
      await refreshUser();
      toast.success('Profile photo updated');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const desktopHref =
    DESKTOP_URL ||
    (typeof window !== 'undefined' ? `${window.location.origin}/cms` : '/cms');

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cms-onboarding-title"
    >
      <div className="relative flex max-h-[min(640px,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.2)]">
        <div className="border-b border-[#f1f5f9] px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[#1e3a8a]">
              Welcome to SheepMug
            </p>
            <button
              type="button"
              onClick={() => void finish()}
              disabled={finishing}
              className="text-[13px] font-semibold text-[#64748b] hover:text-[#0f172a] disabled:opacity-50"
            >
              Skip tour
            </button>
          </div>
          <div className="mt-3 flex gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-[#1e3a8a]' : 'bg-[#e2e8f0]'}`}
              />
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

          {current === 'welcome' ? (
            <div className="flex flex-col items-center text-center">
              <div className="flex h-[200px] w-[200px] items-center justify-center rounded-full bg-[#f3f4f6]">
                <Heart className="h-20 w-20 text-[#111827]" strokeWidth={1.25} />
              </div>
              <h2 id="cms-onboarding-title" className="mt-6 text-[13px] font-semibold text-[#111827]">
                Welcome,
              </h2>
              <p className="text-[26px] font-extrabold leading-tight text-[#0f172a]">{firstName}</p>
              {orgLabel ? (
                <p className="mt-1 text-[15px] font-semibold text-[#64748b]">{orgLabel}</p>
              ) : null}
              <p className="mt-4 text-[14px] leading-relaxed text-[#64748b]">
                Take a minute to see what you can do in SheepMug on the web. You can skip anytime.
              </p>
            </div>
          ) : null}

          {current === 'photo' ? (
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                <button
                  type="button"
                  onClick={pickPhoto}
                  disabled={uploading}
                  className="relative flex h-[200px] w-[200px] items-center justify-center overflow-hidden rounded-full bg-[#eff6ff] ring-2 ring-[#e0e7ff] disabled:opacity-70"
                >
                  {user?.profile_image ? (
                    <img
                      src={user.profile_image}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-5xl font-bold text-[#1e3a8a]">
                      {(firstName[0] || 'U').toUpperCase()}
                    </span>
                  )}
                  {uploading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white">
                      <Loader2 className="h-10 w-10 animate-spin" />
                      <span className="mt-2 text-[13px] font-medium">Uploading…</span>
                    </div>
                  ) : null}
                </button>
                {user?.profile_image && !uploading ? (
                  <button
                    type="button"
                    onClick={pickPhoto}
                    className="absolute bottom-2 right-2 flex h-11 w-11 items-center justify-center rounded-full border border-[#e5e7eb] bg-white shadow-md hover:bg-[#f8fafc]"
                    aria-label="Edit profile photo"
                  >
                    <Pencil className="h-5 w-5 text-[#111827]" />
                  </button>
                ) : null}
              </div>
              <h2 className="mt-6 text-[22px] font-bold text-[#111827]">Add a profile photo</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-[#64748b]">
                Help your team recognize you. Optional—you can change this later in profile settings.
              </p>
              <button
                type="button"
                onClick={pickPhoto}
                disabled={uploading}
                className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#d1d5db] px-5 py-2.5 text-[14px] font-semibold text-[#111827] hover:bg-[#f9fafb] disabled:opacity-60"
              >
                <Camera className="h-4 w-4" />
                {uploading ? 'Uploading…' : user?.profile_image ? 'Profile image set' : 'Choose photo'}
              </button>
            </div>
          ) : null}

          {current === 'members' ? (
            <div className="flex flex-col items-center text-center">
              <div className="flex h-[200px] w-[200px] items-center justify-center rounded-full bg-[#eff6ff]">
                <Users className="h-20 w-20 text-[#111827]" strokeWidth={1.25} />
              </div>
              <h2 className="mt-6 text-[22px] font-bold text-[#111827]">Members and tasks</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-[#64748b]">
                Keep people and leader tasks together so follow-ups stay visible and ministry stays organized.
              </p>
            </div>
          ) : null}

          {current === 'attendance' ? (
            <div className="flex flex-col items-center text-center">
              <div className="flex h-[200px] w-[200px] items-center justify-center rounded-full bg-[#fef9c3]">
                <CalendarDays className="h-20 w-20 text-[#111827]" strokeWidth={1.25} />
              </div>
              <h2 className="mt-6 text-[22px] font-bold text-[#111827]">Attendance and reports</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-[#64748b]">
                Track attendance, notice when someone has not been present for a while, and use reports for pastoral
                care—all from the web dashboard.
              </p>
            </div>
          ) : null}

          {current === 'apps' ? (
            <div className="flex flex-col items-center text-center">
              <div className="flex h-[200px] w-[200px] items-center justify-center rounded-full bg-[#ede9fe]">
                <Smartphone className="h-20 w-20 text-[#111827]" strokeWidth={1.25} />
              </div>
              <h2 className="mt-6 text-[22px] font-bold text-[#111827]">SheepMug on every device</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-[#64748b]">
                Use SheepMug in the browser here, or install the mobile apps and desktop experience when available.
              </p>

              <div className="mt-6 flex w-full max-w-sm flex-col items-stretch gap-4">
                {IOS_STORE_URL ? (
                  <a
                    href={IOS_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex justify-center"
                  >
                    <img src={APP_STORE_BADGE} alt="Download on the App Store" className="h-12 w-auto object-contain" />
                  </a>
                ) : (
                  <div className="flex flex-col items-center gap-1 opacity-80">
                    <img src={APP_STORE_BADGE} alt="" className="h-12 w-auto object-contain grayscale" />
                    <p className="text-center text-[12px] text-[#94a3b8]">Set VITE_IOS_APP_URL for your App Store link.</p>
                  </div>
                )}

                {ANDROID_STORE_URL ? (
                  <a
                    href={ANDROID_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex justify-center"
                  >
                    <img src={PLAY_STORE_BADGE} alt="Get it on Google Play" className="h-[52px] w-auto object-contain" />
                  </a>
                ) : (
                  <div className="flex flex-col items-center gap-1 opacity-80">
                    <img src={PLAY_STORE_BADGE} alt="" className="h-[52px] w-auto object-contain grayscale" />
                    <p className="text-center text-[12px] text-[#94a3b8]">Set VITE_ANDROID_APP_URL for your Play Store link.</p>
                  </div>
                )}

                <a
                  href={desktopHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-xl border border-[#1e3a8a] bg-[#1e3a8a] px-4 py-3 text-[14px] font-semibold text-white hover:bg-[#1b357a]"
                >
                  <Monitor className="h-5 w-5" />
                  Open web app (desktop)
                </a>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#f1f5f9] px-6 py-4">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0 || finishing}
            className="rounded-lg px-4 py-2.5 text-[14px] font-semibold text-[#64748b] hover:bg-[#f8fafc] disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              if (step < steps.length - 1) goNext();
              else void finish();
            }}
            disabled={finishing}
            className="inline-flex min-w-[120px] items-center justify-center rounded-lg bg-[#1e3a8a] px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-[#1b357a] disabled:opacity-60"
          >
            {finishing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : step < steps.length - 1 ? (
              'Next'
            ) : (
              'Get started'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
