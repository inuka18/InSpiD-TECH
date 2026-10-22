import { useCallback, useEffect, useState } from "react";
import { fetchSignals } from "../services/signalsService";

// includeSuppressed: the feed also needs repeats of rejected candidates (it hides them behind a toggle).
export function useSignals(projectId, { includeSuppressed = false } = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSignals(projectId, { includeSuppressed })
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
  }, [projectId, includeSuppressed]);

  useEffect(() => reload(), [reload]);

  return { data, setData, loading, error, reload };
}
