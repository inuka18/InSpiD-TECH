import { useCallback, useEffect, useState } from "react";
import { fetchCandidates } from "../services/signalsService";

// Pending requirement candidates of a project (possible new requirements waiting for a PM decision).
export function useCandidates(projectId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    let cancelled = false;
    if (!projectId) {
      setData([]);
      setLoading(false);
      return () => {};
    }
    setLoading(true);
    setError(null);
    fetchCandidates(projectId, "pending")
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
