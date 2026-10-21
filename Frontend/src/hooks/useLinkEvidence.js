import { useEffect, useState } from "react";
import { fetchLinkEvidence } from "../services/networkService";

// Evidence behind one computed link (contributions + supporting signals). Pass linkId = null to skip.
export function useLinkEvidence(projectId, linkId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!projectId || !linkId) {
      setData(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchLinkEvidence(projectId, linkId)
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
  }, [projectId, linkId]);

  return { data, loading, error };
}
