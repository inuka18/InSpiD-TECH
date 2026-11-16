import { useCallback, useEffect, useState } from "react";
import { fetchNetwork } from "../services/networkService";

export function useNetwork(projectId) {
  const [data, setData] = useState({ nodes: [], links: [], clusters: [], warning: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchNetwork(projectId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => reload(), [reload]);

  return { data, loading, error, reload };
}
