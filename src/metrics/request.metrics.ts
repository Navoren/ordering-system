type RequestMetrics = {
    duration: number;
    statusCode: number;
    timestamp: number;
};

const WINDOW_MS = 60_000;

const requests: RequestMetrics[] = [];

export function recordRequestMetrics(
    duration: number,
    statusCode: number
) {
    const timestamp = Date.now();
    requests.push({ duration, statusCode, timestamp });

    removeExpiredMetrics(timestamp);
}

export function removeExpiredMetrics(now: number) {
    const cutoff = now - WINDOW_MS;
    while (requests.length > 0 && requests[0].timestamp < cutoff) {
        requests.shift();
    }
};

function percentile(
    values: number[],
    percentile: number
) {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(
        percentile * sorted.length
    ) - 1;

    return sorted[index];
}

export function getMetrics() {
    const now = Date.now();
    removeExpiredMetrics(now);

    const durations = requests.map(r => r.duration);
    const errors = requests.filter(r => r.statusCode >= 500).length;

    return {
        count: requests.length,
        avg: durations.reduce((a, b) => a + b, 0) / (durations.length || 1),
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
        p99: percentile(durations, 0.99),
        errorRate: requests.length === 0 ? 0 : errors / requests.length,
    }
}