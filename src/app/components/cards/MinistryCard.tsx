import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { MoreVertical, Users, ChevronRight } from 'lucide-react';
import { Group } from '@/types';

interface MinistryCardProps {
  ministry: Group;
  onEdit: (ministry: Group) => void;
  onDelete: (id: string) => void;
}

const PreviewFace: React.FC<{
  imageUrl: string | null;
  initials: string;
  title?: string;
  z: number;
}> = ({ imageUrl, initials, title, z }) => {
  const [failed, setFailed] = useState(false);
  const showImg = Boolean(imageUrl) && !failed;

  return (
    <div
      title={title}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-800 ring-2 ring-white overflow-hidden"
      style={{ zIndex: z }}
    >
      {showImg ? (
        <img
          src={imageUrl!}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{initials}</span>
      )}
    </div>
  );
};

const MinistryCard: React.FC<MinistryCardProps> = ({ ministry, onEdit, onDelete }) => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  const memberCount = ministry.member_count ?? 0;
  const preview = ministry.member_preview ?? [];
  const shownFaces = preview.length;
  const extraCount = Math.max(0, memberCount - shownFaces);

  const leaderName = ministry.profiles
    ? `${ministry.profiles.first_name || ''} ${ministry.profiles.last_name || ''}`.trim()
    : '';
  const leaderLabel = leaderName || (ministry.leader_id ? 'Assigned' : 'None');

  return (
    <div className="relative bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-indigo-100 transition-all duration-200 overflow-hidden group">
      <Link
        to={`/groups/${ministry.id}`}
        className="block p-6 pr-14 text-left focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-inset rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-gray-900 group-hover:text-indigo-700 transition-colors truncate">
              {ministry.name}
            </h3>
            <p className="mt-1 text-sm text-gray-500 line-clamp-2">
              {ministry.description || 'No description provided.'}
            </p>

            {memberCount > 0 && (
              <div className="mt-4 flex items-center">
                <div className="flex items-center pl-1">
                  {preview.map((p, i) => (
                    <div key={p.member_id || i} className={i > 0 ? '-ml-2.5' : ''}>
                      <PreviewFace
                        imageUrl={p.image_url}
                        initials={p.initials}
                        z={10 - i}
                      />
                    </div>
                  ))}
                  {extraCount > 0 && (
                    <div
                      className="-ml-2.5 relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-700 ring-2 ring-white"
                      style={{ zIndex: 0 }}
                      title={`${extraCount} more ${extraCount === 1 ? 'member' : 'members'}`}
                    >
                      +{extraCount}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-600">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-100">
                <Users className="w-3.5 h-3.5 text-indigo-600" />
                {memberCount} {memberCount === 1 ? 'member' : 'members'}
              </span>
              <span className="text-gray-400">·</span>
              <span className="truncate max-w-[12rem]" title={leaderLabel}>
                Leader: {leaderLabel}
              </span>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-indigo-500 shrink-0 mt-1 transition-colors" />
        </div>
      </Link>

      <div className="absolute top-4 right-4 z-10" ref={menuRef}>
        <button
          type="button"
          aria-label="Open menu"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
          className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 mt-1 w-44 py-1 bg-white rounded-xl shadow-lg border border-gray-100 z-20 text-sm">
            <button
              type="button"
              className="w-full text-left px-4 py-2.5 text-gray-700 hover:bg-gray-50"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onEdit(ministry);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="w-full text-left px-4 py-2.5 text-gray-700 hover:bg-gray-50"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                navigate(`/groups/${ministry.id}`);
              }}
            >
              View members
            </button>
            <div className="border-t border-gray-100 my-1" />
            <button
              type="button"
              className="w-full text-left px-4 py-2.5 text-red-600 hover:bg-red-50"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete(ministry.id);
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MinistryCard;
