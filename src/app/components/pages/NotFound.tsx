import { Link } from 'react-router';
import { Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <h1 className="text-6xl font-bold text-gray-900">404</h1>
      <p className="mt-4 text-xl text-gray-600">Page not found</p>
      <p className="mt-2 text-gray-500">The page you're looking for doesn't exist.</p>
      <Link
        to="/"
        className="mt-8 flex items-center px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
      >
        <Home className="w-5 h-5 mr-2" />
        Back to Dashboard
      </Link>
    </div>
  );
}
