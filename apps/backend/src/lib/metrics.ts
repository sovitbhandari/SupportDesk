type RequestMetrics = {
  total: number;
  byStatusClass: Record<string, number>;
  latencyBucketsMs: Record<string, number>;
};

const latencyBucketBounds = [50, 100, 250, 500, 1000, 2500, 5000];

const requests: RequestMetrics = {
  total: 0,
  byStatusClass: {},
  latencyBucketsMs: Object.fromEntries([
    ...latencyBucketBounds.map((bound) => [`le_${bound}`, 0]),
    ["gt_5000", 0]
  ])
};

export function recordRequest(statusCode: number, durationMs: number) {
  requests.total += 1;
  const statusClass = `${Math.floor(statusCode / 100)}xx`;
  requests.byStatusClass[statusClass] = (requests.byStatusClass[statusClass] ?? 0) + 1;

  const bucket = latencyBucketBounds.find((bound) => durationMs <= bound);
  const key = bucket === undefined ? "gt_5000" : `le_${bucket}`;
  requests.latencyBucketsMs[key] += 1;
}

export function snapshotRequestMetrics() {
  return {
    requests: {
      total: requests.total,
      byStatusClass: { ...requests.byStatusClass },
      latencyBucketsMs: { ...requests.latencyBucketsMs }
    },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      memoryRssBytes: process.memoryUsage().rss
    }
  };
}
