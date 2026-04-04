import { useState } from 'react';
import { Database, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { testConnection, organizationApi, statsApi } from '../utils/api';
import { toast } from 'sonner';

export default function DatabaseConnectionTest() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    details?: any;
  } | null>(null);

  const runTest = async () => {
    setTesting(true);
    setResult(null);

    try {
      // Test 1: Health check
      const healthCheck = await testConnection();
      
      if (!healthCheck.success) {
        setResult({
          success: false,
          message: 'API connection failed',
          details: healthCheck,
        });
        toast.error('API connection failed');
        setTesting(false);
        return;
      }

      // Test 2: Try to fetch organizations
      const orgsResponse = await organizationApi.getAll();
      
      if (!orgsResponse.success) {
        setResult({
          success: false,
          message: 'Failed to fetch organizations',
          details: orgsResponse,
        });
        toast.error('Failed to fetch organizations');
        setTesting(false);
        return;
      }

      // Test 3: Debug Supabase Admin
      const debugResponse = await fetch('/api/debug/supabase');
      const debugData = await debugResponse.json();
      
      if (!debugResponse.ok) {
        setResult({
          success: false,
          message: 'Supabase Admin connection failed',
          details: debugData,
        });
        toast.error('Supabase Admin connection failed');
        setTesting(false);
        return;
      }

      setResult({
        success: true,
        message: 'Database connection successful!',
        details: {
          health: healthCheck.data,
          organizationCount: orgsResponse.data?.length || 0,
          adminDebug: debugData
        },
      });
      
      toast.success('Database connected successfully!');
    } catch (error) {
      setResult({
        success: false,
        message: 'Connection test failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
      toast.error('Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
          <Database className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-900">Database Connection Test</h3>
          <p className="text-sm text-gray-600">Test your Supabase database connection</p>
        </div>
      </div>

      <button
        onClick={runTest}
        disabled={testing}
        className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm font-medium"
      >
        {testing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Testing Connection...
          </>
        ) : (
          'Run Connection Test'
        )}
      </button>

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mt-4 p-4 rounded-lg border ${
            result.success
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          }`}
        >
          <div className="flex items-start gap-3">
            {result.success ? (
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className={`text-sm font-medium ${
                result.success ? 'text-green-900' : 'text-red-900'
              }`}>
                {result.message}
              </p>
              {result.details && (
                <div className="mt-2 text-xs font-mono bg-white p-3 rounded border border-gray-200 overflow-auto max-h-48">
                  <pre>{JSON.stringify(result.details, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      <div className="mt-4 text-xs text-gray-600 space-y-1">
        <p><strong>Note:</strong> This test will:</p>
        <ul className="list-disc list-inside ml-2 space-y-0.5">
          <li>Check API health endpoint</li>
          <li>Verify database connection</li>
          <li>Test organizations table access</li>
          <li>Verify Supabase Admin (Service Role) permissions</li>
        </ul>
      </div>
    </div>
  );
}