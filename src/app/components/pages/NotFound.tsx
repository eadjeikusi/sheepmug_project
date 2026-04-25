import { Link } from 'react-router';
import { Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-5xl font-bold text-gray-900 sm:text-6xl">404</h1>
      <p className="mt-4 text-lg text-gray-600 sm:text-xl">Page not found</p>
      <p className="mt-2 text-sm text-gray-500 sm:text-base">The page you're looking for doesn't exist.</p>
      <Link
        to="/"
        className="mt-8 inline-flex min-h-11 items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        <Home className="w-5 h-5 mr-2" />
        Back to Dashboard
      </Link>
    </div>
  );
}
