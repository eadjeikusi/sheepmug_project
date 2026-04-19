import { useCallback, useEffect, useState } from "react";
import { ApiError, type GroupTypeOption } from "@sheepmug/shared-api";
import { api } from "../lib/api";

export function useGroupTypeOptions(enabled = true) {
  const [options, setOptions] = useState<GroupTypeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setOptions([]);
      setTableMissing(false);
      return;
    }
    setLoading(true);
    try {
      const list = await api.groupTypeOptions.list();
      setTableMissing(false);
      setOptions(Array.isArray(list) ? list : []);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setTableMissing(true);
        setOptions([]);
      } else {
        setTableMissing(false);
        setOptions([]);
      }
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { options, loading, refresh, tableMissing };
}
