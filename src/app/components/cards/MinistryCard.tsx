import React from 'react';
import { Link } from 'react-router';
import { Edit2, Trash2, Users, ChevronRight } from 'lucide-react';
import { Group } from '@/types';
import { displayTitleWords } from '@/utils/displayText';

interface MinistryCardProps {
  ministry: Group;
  onEdit?: (ministry: Group) => void;
  onDelete?: (id: string) => void;
}

const PreviewFace: React.FC<{
  imageUrl: string | null;
  initials: string;
  title?: string;
  z: number;
}> = ({ imageUrl, initials, title, z }) => {
  const [failed, setFailed] = React.useState(false);
  const showImg = Boolean(imageUrl) && !failed;

  return (
    <div
      title={title}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-800 ring-2 ring-white overflow-hidden"
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
  const hasActions = Boolean(onEdit || onDelete);
  const memberCount = ministry.member_count ?? 0;
  const preview = ministry.member_preview ?? [];
  const shownFaces = preview.length;
  const extraCount = Math.max(0, memberCount - shownFaces);

  const leaderName = ministry.profiles
    ? `${ministry.profiles.first_name || ''} ${ministry.profiles.last_name || ''}`.trim()
    : '';
  const leaderLabel = leaderName || (ministry.leader_id ? 'Assigned' : 'None');

  return (
    <div className="relative bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-blue-100 transition-all duration-200 overflow-hidden group">
      <Link
        to={`/groups/${ministry.id}`}
        className={`block p-6 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset rounded-2xl ${hasActions ? 'pr-24' : 'pr-14'}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-700 transition-colors truncate">
              {displayTitleWords(ministry.name)}
            </h3>
            <p className="mt-1 text-sm text-gray-500 line-clamp-2">
              {ministry.description
                ? displayTitleWords(ministry.description)
                : 'No description provided.'}
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
                <Users className="w-3.5 h-3.5 text-blue-600" />
                {memberCount} {memberCount === 1 ? 'member' : 'members'}
              </span>
              <span className="text-gray-400">·</span>
              <span className="truncate max-w-[12rem]" title={leaderLabel}>
                Leader: {leaderLabel}
              </span>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500 shrink-0 mt-1 transition-colors" />
        </div>
      </Link>

      {hasActions ? (
        <div
          className="absolute top-4 right-4 z-10 flex items-center gap-1 transition-opacity duration-200 opacity-100 pointer-events-auto md:opacity-0 md:pointer-events-none md:group-hover:opacity-100 md:group-hover:pointer-events-auto md:group-focus-within:opacity-100 md:group-focus-within:pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {onEdit ? (
            <button
              type="button"
              aria-label={`Edit ${ministry.name}`}
              title="Edit"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEdit(ministry);
              }}
              className="p-2 rounded-xl text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 hover:ring-1 hover:ring-blue-200/80"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              aria-label={`Delete ${ministry.name}`}
              title="Delete"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(ministry.id);
              }}
              className="p-2 rounded-xl text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 hover:ring-1 hover:ring-red-200/70"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default MinistryCard;
