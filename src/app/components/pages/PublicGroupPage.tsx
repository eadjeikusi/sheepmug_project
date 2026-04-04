import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';

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
}

const PublicGroupPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [groupData, setGroupData] = useState<PublicGroupData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setError("Missing group slug.");
      setLoading(false);
      return;
    }

    const fetchPublicGroup = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`http://localhost:3000/api/public/groups/${slug}`);
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to fetch public group information');
        }
        const data = await response.json();
        setGroupData(data);
      } catch (err: any) {
        setError(err.message);
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchPublicGroup();
  }, [slug]);

  if (loading) {
    return (
      <div className="flex flex-col flex-1 p-6 items-center justify-center min-h-screen bg-gray-100">
        <p className="text-gray-600">Loading public group page...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col flex-1 p-6 items-center justify-center min-h-screen bg-gray-100">
        <p className="text-red-500">Error: {error}</p>
      </div>
    );
  }

  if (!groupData) {
    return (
      <div className="flex flex-col flex-1 p-6 items-center justify-center min-h-screen bg-gray-100">
        <h1 className="text-3xl font-bold text-gray-900">Group Not Found</h1>
        <p className="mt-2 text-gray-600">The requested public group page could not be found or is not enabled.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      {groupData.cover_image_url && (
        <div 
          className="relative h-64 bg-cover bg-center mb-8"
          style={{ backgroundImage: `url(${groupData.cover_image_url})` }}
        >
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
            <h1 className="text-5xl font-extrabold text-white text-center drop-shadow-lg">{groupData.name}</h1>
          </div>
        </div>
      )}

      {!groupData.cover_image_url && (
        <div className="bg-indigo-700 py-16 mb-8 text-white text-center">
          <h1 className="text-5xl font-extrabold drop-shadow-lg">{groupData.name}</h1>
        </div>
      )}

      <div className="container mx-auto px-4 py-8 max-w-4xl bg-white shadow-lg rounded-lg">
        {groupData.description && (
          <section className="mb-8">
            <h2 className="text-3xl font-semibold text-indigo-700 mb-4">About Us</h2>
            <p className="text-lg leading-relaxed">{groupData.description}</p>
          </section>
        )}

        {groupData.announcements_content && (
          <section className="mb-8">
            <h2 className="text-3xl font-semibold text-indigo-700 mb-4">Announcements</h2>
            <div 
              className="prose prose-indigo max-w-none"
              dangerouslySetInnerHTML={{ __html: groupData.announcements_content }}
            />
          </section>
        )}

        {groupData.program_outline_content && (
          <section className="mb-8">
            <h2 className="text-3xl font-semibold text-indigo-700 mb-4">Program Outline</h2>
            <div 
              className="prose prose-indigo max-w-none"
              dangerouslySetInnerHTML={{ __html: groupData.program_outline_content }}
            />
          </section>
        )}

        {groupData.leader_name && (
          <section className="mb-8">
            <h2 className="text-3xl font-semibold text-indigo-700 mb-4">Our Leader</h2>
            <p className="text-lg">{groupData.leader_name}</p>
          </section>
        )}

        {(groupData.contact_email || groupData.contact_phone) && (
          <section className="mb-8">
            <h2 className="text-3xl font-semibold text-indigo-700 mb-4">Contact Us</h2>
            {groupData.contact_email && <p className="text-lg">Email: <a href={`mailto:${groupData.contact_email}`} className="text-indigo-600 hover:underline">{groupData.contact_email}</a></p>}
            {groupData.contact_phone && <p className="text-lg">Phone: {groupData.contact_phone}</p>}
          </section>
        )}

        {groupData.join_link_enabled && (
          <section className="text-center mt-12 p-6 bg-indigo-50 rounded-lg">
            <h2 className="text-3xl font-bold text-indigo-800 mb-4">Want to Join?</h2>
            <p className="text-lg text-indigo-700 mb-6">Click the button below to request to join our group!</p>
            <a 
              href={`/join-group/${groupData.join_invite_token || groupData.id}`}
              className="inline-flex items-center px-8 py-4 border border-transparent text-xl font-medium rounded-full shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transform transition-transform duration-200 hover:scale-105"
            >
              Join Our Group
            </a>
          </section>
        )}
      </div>

      <footer className="mt-12 py-8 bg-gray-800 text-white text-center">
        <p>&copy; {new Date().getFullYear()} {groupData.name}. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default PublicGroupPage;
