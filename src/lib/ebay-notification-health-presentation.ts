export type TradingNotificationHealthState =
  | "active"
  | "setup_required"
  | "delivery_attention"
  | "fallback";

export type TradingNotificationHealth = {
  authorization: {
    checkedAt: Date | string | null;
    expiresAt: Date | string | null;
    renewalRequired: boolean;
    status: "missing" | "active" | "revoked" | "expired" | "invalid";
  };
  configured: boolean;
  demonstrated: boolean;
  events: Array<{ status: string; topic: string }>;
  lastError: string | null;
  lastNotificationAt: Date | string | null;
  lastVerifiedAt: Date | string | null;
  state: TradingNotificationHealthState;
};

export function tradingNotificationHealthState({
  configured,
  deliveryAttention,
  demonstrated,
}: {
  configured: boolean;
  deliveryAttention: boolean;
  demonstrated: boolean;
}): TradingNotificationHealthState {
  if (!configured) return "setup_required";
  if (deliveryAttention) return "delivery_attention";
  return demonstrated ? "active" : "fallback";
}

export function tradingNotificationHealthPresentation(state: TradingNotificationHealthState) {
  switch (state) {
    case "active":
      return {
        badge: "Active",
        description: "Trading notifications are configured and Records has received a notification. Listing and checkout changes are reconciled against eBay before Records updates your tracked Copies.",
        heading: "Automatic Listing and checkout updates active",
        tone: "success" as const,
      };
    case "setup_required":
      return {
        badge: "Setup required",
        description: "Trading notifications are not ready yet. Records will keep using manual refresh, interaction-time checks, and daily reconciliation until setup is verified.",
        heading: "Setup required",
        tone: "warning" as const,
      };
    case "delivery_attention":
      return {
        badge: "Delivery needs attention",
        description: "Trading notification delivery needs attention. Records keeps its other checks active while you review the setup and delivery details below.",
        heading: "Delivery needs attention",
        tone: "warning" as const,
      };
    case "fallback":
      return {
        badge: "Fallback checks active",
        description: "Records is falling back to interaction-time and daily checks while automatic Trading notification updates are unavailable.",
        heading: "Falling back to interaction and daily checks",
        tone: "warning" as const,
      };
  }
}
