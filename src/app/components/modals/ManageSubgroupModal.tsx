import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { toast } from 'sonner';
import { Group } from '../../utils/supabase';
import { useGroupTypeOptions } from '@/hooks/useGroupTypeOptions';

interface ManageSubgroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentGroupId: string;
  editingSubgroup?: Group | null;
  onSubgroupManaged: () => void;
}

const ManageSubgroupModal: React.FC<ManageSubgroupModalProps> = ({
  isOpen,
  onClose,
  parentGroupId,
  editingSubgroup,
  onSubgroupManaged,
}) => {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const { options: groupTypeOpts } = useGroupTypeOptions(isOpen);
  const sortedGroupTypes = useMemo(
    () =>
      [...groupTypeOpts].sort(
        (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
      ),
    [groupTypeOpts],
  );
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [groupType, setGroupType] = useState<string>('Subgroup');
  const [leaderId, setLeaderId] = useState<string | null>(null);
  const [availableMembers, setAvailableMembers] = useState<any[]>([]);
  const [loadingAvailableMembers, setLoadingAvailableMembers] = useState<boolean>(true);
  const [errorAvailableMembers, setErrorAvailableMembers] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchAvailableMembers();
      if (editingSubgroup) {
        setName(editingSubgroup.name);
        setDescription(editingSubgroup.description || '');
        setGroupType((editingSubgroup.group_type || '').trim() || 'Subgroup');
        setLeaderId(editingSubgroup.leader_id || null);
      } else {
        setName('');
        setDescription('');
        const fallback =
          sortedGroupTypes.find((o) => /subgroup/i.test(o.label))?.label ||
          sortedGroupTypes[0]?.label ||
          'Subgroup';
        setGroupType(fallback);
        setLeaderId(null);
      }
    }
  }, [isOpen, editingSubgroup, sortedGroupTypes]);

  const fetchAvailableMembers = async () => {
    setLoadingAvailableMembers(true);
    setErrorAvailableMembers(null);
    try {
      const response = await fetch(`${window.location.origin}/api/members`, {
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch available members');
      }
      const data = await response.json();
      setAvailableMembers(Array.isArray(data) ? data : Array.isArray(data?.members) ? data.members : []);
    } catch (err: any) {
      setErrorAvailableMembers(err.message);
      toast.error(err.message);
    } finally {
      setLoadingAvailableMembers(false);
    }
  };

  const handleSubmit = async () => {
    if (!token || !parentGroupId) return;
    if (!name.trim()) {
      toast.error("Subgroup name cannot be empty.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = editingSubgroup
        ? `/api/groups/${editingSubgroup.id}`
        : `/api/groups`;
      const method = editingSubgroup ? 'PUT' : 'POST';

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        group_type: groupType,
        parent_group_id: parentGroupId,
        leader_id: leaderId,
        // Other fields like public_website_enabled, join_link_enabled can be added later
      };

      const response = await fetch(url, {
        method,
        headers: withBranchScope(selectedBranch?.id, {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        }),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save subgroup');
      }

      toast.success(editingSubgroup ? 'Subgroup updated successfully!' : 'Subgroup created successfully!');
      onSubgroupManaged();
      onClose();
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 className="text-2xl font-bold mb-4">
          {editingSubgroup ? 'Edit Subgroup' : 'Create New Subgroup'}
        </h2>

        <div className="mb-4">
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">Subgroup Name</label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            required
          />
        </div>

        <div className="mb-4">
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description (Optional)</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          ></textarea>
        </div>

        <div className="mb-4">
          <label htmlFor="groupType" className="block text-sm font-medium text-gray-700">Group type</label>
          {sortedGroupTypes.length === 0 ? (
            <input
              type="text"
              id="groupType"
              value={groupType}
              onChange={(e) => setGroupType(e.target.value)}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              required
            />
          ) : (
            <select
              id="groupType"
              value={sortedGroupTypes.some((o) => o.label === groupType) ? groupType : ''}
              onChange={(e) => setGroupType(e.target.value)}
              className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md border"
              required
            >
              {!sortedGroupTypes.some((o) => o.label === groupType) && groupType ? (
                <option value={groupType}>{groupType} (current)</option>
              ) : null}
              {sortedGroupTypes.map((o) => (
                <option key={o.id} value={o.label}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="mb-4">
          <label htmlFor="leaderSelect" className="block text-sm font-medium text-gray-700">Leader (Optional)</label>
          <select
            id="leaderSelect"
            value={leaderId || ''}
            onChange={(e) => setLeaderId(e.target.value === '' ? null : e.target.value)}
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            disabled={loadingAvailableMembers}
          >
            <option value="">{loadingAvailableMembers ? 'Loading...' : 'No Leader'}</option>
            {errorAvailableMembers && <option value="" disabled>Error loading members</option>}
            {availableMembers.map(member => (
              <option key={member.id} value={member.id}>
                {member.first_name} {member.last_name}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-red-500 text-sm mb-4">Error: {error}</p>}

        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            disabled={loading}
          >
            {editingSubgroup ? 'Save Changes' : 'Create Subgroup'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManageSubgroupModal;
