import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { Group } from '@/types';
import { toast } from 'sonner';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { Loader2 } from 'lucide-react';
import { useGroupTypeOptions } from '@/hooks/useGroupTypeOptions';

interface AddMinistryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void; // Callback to refresh ministry list
  ministryToEdit?: Group | null;
}

const AddMinistryModal: React.FC<AddMinistryModalProps> = ({ isOpen, onClose, onSave, ministryToEdit }) => {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const { options: groupTypeOptions } = useGroupTypeOptions(isOpen);
  const sortedGroupTypes = useMemo(
    () =>
      [...groupTypeOptions].sort(
        (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
      ),
    [groupTypeOptions],
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [groupType, setGroupType] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (ministryToEdit) {
      setName(ministryToEdit.name);
      setDescription(ministryToEdit.description || '');
      setGroupType((ministryToEdit.group_type || '').trim());
    } else {
      setName('');
      setDescription('');
      setGroupType('');
    }
  }, [ministryToEdit, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (ministryToEdit) return;
    if (sortedGroupTypes.length === 0) {
      setGroupType('Ministry');
      return;
    }
    setGroupType((prev) => {
      if (prev && sortedGroupTypes.some((o) => o.label === prev)) return prev;
      return sortedGroupTypes[0].label;
    });
  }, [isOpen, ministryToEdit, sortedGroupTypes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedBranch) {
      toast.error('Authentication required or no branch selected.');
      return;
    }

    const gt = groupType.trim();
    if (!gt) {
      toast.error('Select a group type.');
      return;
    }

    setIsLoading(true);
    try {
      const payload = ministryToEdit
        ? {
            name,
            description: description || null,
            group_type: gt,
          }
        : {
            name,
            description: description || null,
            group_type: gt,
          };

      const url = ministryToEdit ? `/api/groups/${ministryToEdit.id}` : '/api/groups';
      const method = ministryToEdit ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: withBranchScope(selectedBranch.id, {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        }),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save ministry');
      }

      toast.success(ministryToEdit ? 'Ministry updated successfully!' : 'Ministry created successfully!');
      onSave(); // Refresh the list of ministries
      onClose(); // Close the modal
    } catch (err: any) {
      toast.error(err.message || 'Failed to save ministry');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{ministryToEdit ? 'Edit Ministry' : 'Create New Ministry'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="col-span-3"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="description" className="text-right">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="groupType" className="text-right">Group type</Label>
            {sortedGroupTypes.length === 0 ? (
              <Input
                id="groupType"
                value={groupType}
                onChange={(e) => setGroupType(e.target.value)}
                className="col-span-3"
                placeholder="e.g. Ministry (add presets in Settings → Group types)"
                required
              />
            ) : (
              <select
                id="groupType"
                value={sortedGroupTypes.some((o) => o.label === groupType) ? groupType : ''}
                onChange={(e) => setGroupType(e.target.value)}
                className="col-span-3 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {ministryToEdit ? 'Save Changes' : 'Create Ministry'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddMinistryModal;
