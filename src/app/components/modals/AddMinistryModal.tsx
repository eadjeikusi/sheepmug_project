import React, { useState, useEffect, useContext } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { Group } from '@/types';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface AddMinistryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void; // Callback to refresh ministry list
  ministryToEdit?: Group | null;
}

const AddMinistryModal: React.FC<AddMinistryModalProps> = ({ isOpen, onClose, onSave, ministryToEdit }) => {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [groupType, setGroupType] = useState('ministry'); // Default to 'ministry'
  const [publicWebsiteEnabled, setPublicWebsiteEnabled] = useState(false);
  const [joinLinkEnabled, setJoinLinkEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (ministryToEdit) {
      setName(ministryToEdit.name);
      setDescription(ministryToEdit.description || '');
      setGroupType(ministryToEdit.group_type || 'ministry');
      setPublicWebsiteEnabled(ministryToEdit.public_website_enabled || false);
      setJoinLinkEnabled(ministryToEdit.join_link_enabled || false);
    } else {
      // Reset form for new ministry
      setName('');
      setDescription('');
      setGroupType('ministry');
      setPublicWebsiteEnabled(false);
      setJoinLinkEnabled(false);
    }
  }, [ministryToEdit, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedBranch) {
      toast.error('Authentication required or no branch selected.');
      return;
    }

    setIsLoading(true);
    try {
      const payload = {
        name,
        description,
        group_type: groupType,
        public_website_enabled: publicWebsiteEnabled,
        join_link_enabled: joinLinkEnabled,
        branch_id: selectedBranch.id,
        organization_id: selectedBranch.organization_id, // Assuming organization_id is available on selectedBranch
      };

      const url = ministryToEdit ? `/api/groups/${ministryToEdit.id}` : '/api/groups';
      const method = ministryToEdit ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
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
          <DialogDescription>
            {ministryToEdit ? 'Make changes to this ministry here.' : 'Add a new ministry to your organization.'}
          </DialogDescription>
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
          {/* Group Type - can be a dropdown if more types are needed */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="groupType" className="text-right">Group Type</Label>
            <Input
              id="groupType"
              value={groupType}
              onChange={(e) => setGroupType(e.target.value)}
              className="col-span-3"
              disabled // For now, keep it as 'ministry', can be made editable later
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="publicWebsite" className="text-right">Public Website</Label>
            <Switch
              id="publicWebsite"
              checked={publicWebsiteEnabled}
              onCheckedChange={setPublicWebsiteEnabled}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="joinLink" className="text-right">Join Link Enabled</Label>
            <Switch
              id="joinLink"
              checked={joinLinkEnabled}
              onCheckedChange={setJoinLinkEnabled}
              className="col-span-3"
            />
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
