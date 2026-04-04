import { useState, useEffect, useCallback } from 'react';

interface UseApiOptions<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: string) => void;
  autoFetch?: boolean;
}

interface UseApiReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Custom hook for making API calls with loading and error states
 * 
 * @example
 * const { data, loading, error, refetch } = useApi(
 *   () => memberApi.getAll({ organization_id: orgId }),
 *   { autoFetch: true }
 * );
 */
export function useApi<T>(
  apiFn: () => Promise<{ success: boolean; data?: T; error?: string }>,
  options: UseApiOptions<T> = {}
): UseApiReturn<T> {
  const { onSuccess, onError, autoFetch = true } = options;
  
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiFn();

      if (response.success && response.data) {
        setData(response.data);
        onSuccess?.(response.data);
      } else {
        const errorMsg = response.error || 'An error occurred';
        setError(errorMsg);
        onError?.(errorMsg);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Network error';
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [apiFn, onSuccess, onError]);

  useEffect(() => {
    if (autoFetch) {
      fetchData();
    }
  }, [autoFetch, fetchData]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
  };
}

/**
 * Hook for mutations (create, update, delete)
 * 
 * @example
 * const { mutate, loading } = useMutation(
 *   (data) => memberApi.create(data),
 *   { onSuccess: () => toast.success('Created!') }
 * );
 */
export function useMutation<TData, TVariables = any>(
  mutationFn: (variables: TVariables) => Promise<{ success: boolean; data?: TData; error?: string }>,
  options: UseApiOptions<TData> = {}
) {
  const { onSuccess, onError } = options;
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = async (variables: TVariables): Promise<{ success: boolean; data?: TData; error?: string }> => {
    setLoading(true);
    setError(null);

    try {
      const response = await mutationFn(variables);

      if (response.success && response.data) {
        onSuccess?.(response.data);
      } else {
        const errorMsg = response.error || 'An error occurred';
        setError(errorMsg);
        onError?.(errorMsg);
      }

      return response;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Network error';
      setError(errorMsg);
      onError?.(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  };

  return {
    mutate,
    loading,
    error,
  };
}
