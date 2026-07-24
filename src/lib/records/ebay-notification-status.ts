export type EbayNotificationStatusRow = {
  createdAt: Date;
  id: string;
  topic: string;
  updatedAt: Date;
};

export type EbayNotificationPersistenceRow = {
  destinationId: string;
  id: string;
  remoteSubscriptionId: string | null;
};

function rowTimestamp(row: EbayNotificationStatusRow) {
  return [
    row.updatedAt.getTime(),
    row.createdAt.getTime(),
    row.id,
  ] as const;
}

function isNewerStatusRow(
  candidate: EbayNotificationStatusRow,
  current: EbayNotificationStatusRow,
) {
  const candidateTimestamp = rowTimestamp(candidate);
  const currentTimestamp = rowTimestamp(current);
  if (candidateTimestamp[0] !== currentTimestamp[0]) {
    return candidateTimestamp[0] > currentTimestamp[0];
  }
  if (candidateTimestamp[1] !== currentTimestamp[1]) {
    return candidateTimestamp[1] > currentTimestamp[1];
  }
  return candidateTimestamp[2] > currentTimestamp[2];
}

/**
 * Legacy rows may exist for an earlier webhook destination. Only the newest
 * observation for each topic represents the destination the app most recently
 * tried to configure.
 */
export function latestEbayNotificationStatusRows<
  Row extends EbayNotificationStatusRow,
>(rows: Row[]) {
  const latestByTopic = new Map<string, Row>();
  for (const row of rows) {
    const current = latestByTopic.get(row.topic);
    if (!current || isNewerStatusRow(row, current)) {
      latestByTopic.set(row.topic, row);
    }
  }
  return [...latestByTopic.values()].sort((left, right) => (
    left.topic.localeCompare(right.topic)
  ));
}

export function planEbayNotificationRowConsolidation({
  destinationId,
  remoteSubscriptionId,
  rows,
}: {
  destinationId: string;
  remoteSubscriptionId?: string | null;
  rows: EbayNotificationPersistenceRow[];
}) {
  const preferred = (
    remoteSubscriptionId
      ? rows.find((row) => row.remoteSubscriptionId === remoteSubscriptionId)
      : null
  ) ?? rows.find((row) => row.destinationId === destinationId)
    ?? rows[0];
  return {
    preferredId: preferred?.id ?? null,
    staleIds: rows
      .filter((row) => row.id !== preferred?.id)
      .map((row) => row.id),
  };
}

export function publicEbayNotificationError(message: string | null) {
  if (!message) return null;
  if (
    message.includes("Failed query:")
    || message.includes("params:")
    || /\b(insert|update|delete|select)\s+(into|from|")[^]*\$/i.test(message)
  ) {
    return "Records could not save the latest notification status. Retry setup after confirming the production database schema is up to date.";
  }
  return message;
}
