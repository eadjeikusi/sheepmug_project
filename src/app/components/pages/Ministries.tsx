import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { Button } from '@/components/ui/button';
import { Loader2, Plus } from 'lucide-react';
import AddMinistryModal from '../modals/AddMinistryModal';
import { Group } from '@/types';
import { toast } from 'sonner';
import MinistryCard from '../cards/MinistryCard'; // Will create this component

const Ministries: React.FC = () => {
  const { token, authLoading } = useAuth();
  const { selectedBranch } = useBranch();
  const [ministries, setMinistries] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddMinistryModalOpen, setIsAddMinistryModalOpen] = useState(false);
  const [ministryToEdit, setMinistryToEdit] = useState<Group | null>(null);

  const fetchMinistries = useCallback(async () => {
    if (!token || authLoading) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const url = new URL('/api/groups', window.location.origin);
      if (selectedBranch) {
        url.searchParams.append('branch_id', selectedBranch.id);
      }
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ministries: ${response.statusText}`);
      }
      const data = await response.json();
      setMinistries(data);
    } catch (err: any) {
      setError(err.message);
      toast.error('Failed to load ministries');
    } finally {
      setIsLoading(false);
    }
  }, [token, authLoading, selectedBranch]);

  useEffect(() => {
    fetchMinistries();
  }, [fetchMinistries]);

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-gray-600">Loading ministries...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center text-red-600">
        <p>Error: {error}</p>
        <Button onClick={fetchMinistries} className="mt-4">Retry</Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col flex-1 p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Ministries Management</h1>
          <Button onClick={() => { setMinistryToEdit(null); setIsAddMinistryModalOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            Create New Ministry
          </Button>
        </div>
        <p className="mt-2 text-gray-600">Manage all ministries and their subgroups within your organization.</p>

        {ministries.length === 0 ? (
          <div className="flex flex-col flex-1 items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-8 mt-8">
            <p className="text-lg text-gray-500">No ministries found.</p>
            <p className="text-gray-500">Click "Create New Ministry" to add your first ministry.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
            {ministries.map(ministry => (
              <MinistryCard
                key={ministry.id}
                ministry={ministry}
                onEdit={(ministry) => { setMinistryToEdit(ministry); setIsAddMinistryModalOpen(true); }}
                onDelete={async (id) => {
                  if (!window.confirm('Are you sure you want to delete this ministry?')) return;
                  if (!token) {
                    toast.error('Authentication required.');
                    return;
                  }
                  try {
                    const response = await fetch(`/api/groups/${id}`, {
                      method: 'DELETE',
                      headers: {
                        'Authorization': `Bearer ${token}`,
                      },
                    });
                    if (!response.ok) throw new Error('Failed to delete ministry');
                    toast.success('Ministry deleted successfully!');
                    fetchMinistries();
                  } catch (err: any) {
                    toast.error(err.message || 'Failed to delete ministry');
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      <AddMinistryModal
        isOpen={isAddMinistryModalOpen}
        onClose={() => setIsAddMinistryModalOpen(false)}
        onSave={fetchMinistries}
        ministryToEdit={ministryToEdit}
      />
    </>
  );
};

export default Ministries;
