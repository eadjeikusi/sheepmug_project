import { useCallback, useEffect, useRef, useState } from 'react';
import { User as UserIcon, Mail, Lock, Eye, EyeOff, Camera, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { compressImageForUpload, MEMBER_PROFILE_PHOTO_OPTIONS } from '../../utils/compressImageForUpload';

export default function ProfileSettings() {
  const { user, token, refreshUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);

  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.first_name || '');
    setLastName(user.last_name || '');
    setEmail(user.email || '');
    setProfileImageUrl(user.profile_image || null);
  }, [user]);

  const hasProfilePhoto = Boolean(profileImageUrl?.trim());

  const handlePickPhoto = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !token) {
      if (!token) toast.error('Sign in required');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    setUploadingImage(true);
    try {
      const optimized = await compressImageForUpload(file, MEMBER_PROFILE_PHOTO_OPTIONS);
      const fd = new FormData();
      fd.append('image', optimized);
      const res = await fetch('/api/upload-image', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Upload failed');
      const url = data.url as string;
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
        throw new Error(
          typeof patchData?.error === 'string' ? patchData.error : 'Failed to save photo',
        );
      }
      if (patchData.user) {
        setProfileImageUrl(patchData.user.profile_image ?? url);
        await refreshUser();
      } else {
        setProfileImageUrl(url);
        await refreshUser();
      }
      toast.success('Profile photo updated');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      toast.error('Sign in required');
      return;
    }
    const fn = firstName.trim();
    const ln = lastName.trim();
    const em = email.trim().toLowerCase();
    if (!fn || !ln) {
      toast.error('First and last name are required');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      toast.error('Enter a valid email');
      return;
    }

    setSavingProfile(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          first_name: fn,
          last_name: ln,
          email: em,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Save failed');
      }
      if (data.user) {
        setEmail(data.user.email || em);
        setFirstName(data.user.first_name || fn);
        setLastName(data.user.last_name || ln);
      }
      await refreshUser();
      toast.success('Profile saved');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      toast.error('Sign in required');
      return;
    }
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Fill in all password fields');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Could not change password');
      }
      toast.success('Password updated');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordSection(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setSavingPassword(false);
    }
  };

  const removePhoto = useCallback(async () => {
    if (!token) return;
    setUploadingImage(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ profile_image: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to remove photo');
      }
      setProfileImageUrl(null);
      await refreshUser();
      toast.success('Photo removed');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove photo');
    } finally {
      setUploadingImage(false);
    }
  }, [token, refreshUser]);

  if (!user) {
    return (
      <div className="mx-auto max-w-lg min-h-[50dvh] px-4 py-16 text-center text-gray-500">
        Sign in to manage your profile.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-xl space-y-8 px-4 sm:px-0">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Profile</h1>
        <p className="mt-1 text-sm text-gray-500">Your name, email, photo, and password</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="flex flex-col items-center sm:flex-row sm:items-start gap-5">
          <div className="relative shrink-0 w-24 h-24">
            {hasProfilePhoto ? (
              <img
                src={profileImageUrl!.trim()}
                alt=""
                className="w-24 h-24 rounded-full object-cover bg-gray-100 border border-gray-200"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="w-24 h-24 rounded-full bg-gray-50 border border-dashed border-gray-300"
                aria-hidden
              />
            )}
            {uploadingImage && (
              <div className="absolute inset-0 rounded-full bg-white/80 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-gray-500 animate-spin" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 items-center sm:items-start">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelected}
            />
            <button
              type="button"
              onClick={handlePickPhoto}
              disabled={uploadingImage}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50"
            >
              <Camera className="w-4 h-4" />
              Change photo
            </button>
            {profileImageUrl ? (
              <button
                type="button"
                onClick={removePhoto}
                disabled={uploadingImage}
                className="text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50"
              >
                Remove photo
              </button>
            ) : null}
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="profile-first" className="block text-xs font-medium text-gray-600 mb-1.5">
                First name
              </label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  id="profile-first"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  className="min-h-11 w-full pl-9 pr-3 py-2.5 text-base sm:text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label htmlFor="profile-last" className="block text-xs font-medium text-gray-600 mb-1.5">
                Last name
              </label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  id="profile-last"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  className="min-h-11 w-full pl-9 pr-3 py-2.5 text-base sm:text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
          <div>
            <label htmlFor="profile-email" className="block text-xs font-medium text-gray-600 mb-1.5">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                id="profile-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="min-h-11 w-full pl-9 pr-3 py-2.5 text-base sm:text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              Changing email updates your login. You may need to confirm the new address in Supabase.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="submit"
              disabled={savingProfile}
              className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-2"
            >
              {savingProfile && <Loader2 className="w-4 h-4 animate-spin" />}
              Save profile
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 text-gray-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-900">Password</h2>
              <p className="text-xs text-gray-500">Use a strong password you do not reuse elsewhere</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowPasswordSection((v) => !v);
              if (showPasswordSection) {
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
              }
            }}
            className="self-start text-sm font-medium text-blue-600 hover:text-blue-700 sm:self-auto"
          >
            {showPasswordSection ? 'Cancel' : 'Change password'}
          </button>
        </div>

        {showPasswordSection ? (
          <form onSubmit={handleChangePassword} className="mt-6 space-y-4 border-t border-gray-100 pt-6">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Current password</label>
              <div className="relative">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  className="min-h-11 w-full px-3 py-2.5 pr-10 text-base sm:text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowCurrent((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                  aria-label={showCurrent ? 'Hide password' : 'Show password'}
                >
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">New password</label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowNew((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                  aria-label={showNew ? 'Hide password' : 'Show password'}
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Confirm new password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="min-h-11 w-full px-3 py-2.5 pr-10 text-base sm:text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowConfirm((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={savingPassword}
              className="px-5 py-2.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 inline-flex items-center gap-2"
            >
              {savingPassword && <Loader2 className="w-4 h-4 animate-spin" />}
              Update password
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
