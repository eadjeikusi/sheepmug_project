import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { toast } from 'sonner';
import { Member } from '../../utils/supabase';

interface AddMembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  /** Members already in group (client guard in addition to API / not_in_group_id) */
  existingMemberIds?: string[];
  onMembersAdded: () => void;
}

const AddMembersModal: React.FC<AddMembersModalProps> = ({
  isOpen,
  onClose,
  groupId,
  existingMemberIds = [],
  onMembersAdded,
}) => {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const [availableMembers, setAvailableMembers] = useState<Member[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'member' | 'leader' | 'co-leader'>('member');

  const existingSet = useMemo(() => new Set(existingMemberIds.filter(Boolean)), [existingMemberIds]);

  useEffect(() => {
    if (!isOpen || !token || !groupId) return;

    const fetchAvailableMembers = async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ not_in_group_id: groupId });
        qs.set('include_system', '1');
        const response = await fetch(`/api/members?${qs.toString()}`, {
          headers: withBranchScope(selectedBranch?.id, {
            Authorization: `Bearer ${token}`,
          }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to fetch available members');
        }
        const data = await response.json();
        setAvailableMembers(Array.isArray(data) ? data : Array.isArray(data?.members) ? data.members : []);
      } catch (err: any) {
        setError(err.message);
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAvailableMembers();
  }, [isOpen, token, groupId, selectedBranch?.id]);

  useEffect(() => {
    if (!isOpen) setSelectedMembers(new Set());
  }, [isOpen]);

  const listToShow = useMemo(
    () => availableMembers.filter((m) => m.id && !existingSet.has(m.id)),
    [availableMembers, existingSet]
  );

  const handleSelectMember = (memberId: string) => {
    if (existingSet.has(memberId)) {
      toast.info('This member is already in this group.');
      return;
    }
    setSelectedMembers((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(memberId)) {
        newSet.delete(memberId);
      } else {
        newSet.add(memberId);
      }
      return newSet;
    });
  };

  const handleAddMembers = async () => {
    if (selectedMembers.size === 0) {
      toast.info('Please select at least one member.');
      return;
    }

    if (!token || !groupId) return;

    const toAdd = Array.from(selectedMembers).filter((id) => !existingSet.has(id));
    if (toAdd.length === 0) {
      toast.info('All selected members are already in this group.');
      return;
    }

    let added = 0;
    let alreadyInGroup = 0;
    let failed: string | null = null;

    try {
      const response = await fetch(`/api/group-members/bulk`, {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        }),
        body: JSON.stringify({
          group_id: groupId,
          member_ids: toAdd,
          role_in_group: role,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && (data as { code?: string }).code === 'ALREADY_GROUP_MEMBER') {
        alreadyInGroup = toAdd.length;
      } else if (!response.ok) {
        failed = (data as { error?: string }).error || 'Failed to add members';
      } else {
        const payload = data as {
          inserted_count?: number;
          added?: string[];
          skipped?: { reason?: string }[];
        };
        added = payload.inserted_count ?? payload.added?.length ?? 0;
        alreadyInGroup =
          payload.skipped?.filter((s) => s.reason === 'already_in_group').length ?? 0;
      }
    } catch {
      failed = 'Network error while adding members';
    }

    if (failed) {
      toast.error(failed);
      return;
    }

    if (alreadyInGroup > 0) {
      toast.info(
        alreadyInGroup === 1
          ? 'One selected member was already in this group and was skipped.'
          : `${alreadyInGroup} members were already in this group and were skipped.`,
        { duration: 5000 }
      );
    }

    if (added > 0) {
      toast.success(`${added} member(s) added to the group.`);
      onMembersAdded();
      onClose();
      setSelectedMembers(new Set());
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 className="text-2xl font-bold mb-4">Add Members to Group</h2>

        {loading ? (
          <p className="text-gray-600">Loading available members...</p>
        ) : error ? (
          <p className="text-red-500">Error: {error}</p>
        ) : listToShow.length === 0 ? (
          <p className="text-gray-600">No new members available to add.</p>
        ) : (
          <div className="mb-4 max-h-60 overflow-y-auto border rounded-md p-2">
            {listToShow.map((member) => (
              <div key={member.id} className="flex items-center justify-between py-2 border-b last:border-b-0">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedMembers.has(member.id)}
                    onChange={() => handleSelectMember(member.id)}
                    className="form-checkbox h-4 w-4 text-blue-600 transition duration-150 ease-in-out"
                  />
                  <span className="text-gray-900">
                    {member.first_name} {member.last_name}
                  </span>
                </label>
              </div>
            ))}
          </div>
        )}

        <div className="mb-4">
          <label htmlFor="role" className="block text-sm font-medium text-gray-700">
            Assign Role:
          </label>
          <select
            id="role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'member' | 'leader' | 'co-leader')}
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
          >
            <option value="member">Member</option>
            <option value="leader">Leader</option>
            <option value="co-leader">Co-Leader</option>
          </select>
        </div>

        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            onClick={handleAddMembers}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            disabled={selectedMembers.size === 0 || loading}
          >
            Add Selected Members
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddMembersModal;
