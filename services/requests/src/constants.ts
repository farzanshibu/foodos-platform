/**
 * SOT: request-state-machine, request-transitions, request-escalation
 * WHAT   The legal shape of a service request's life.
 * WHY    Same reason as the order machine: a status set inline is a status set to anything.
 *        A customer may withdraw a request nobody has picked up yet and not a moment later;
 *        that rule is one line here rather than a condition somebody forgets to write.
 * NOTE   On the biome useNamingConvention exemption list, because these keys ARE the wire
 *        values and renaming them would mean a second vocabulary for statuses.
 * WHERE  services/requests/src/request.handlers.ts
 */
export const REQUEST_STATUSES = [
  "submitted",
  "acknowledged",
  "in_progress",
  "completed",
  "rejected",
  "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  /** Cancelled only from here: once staff have acknowledged it, somebody is already walking. */
  submitted: ["acknowledged", "rejected", "cancelled"],
  acknowledged: ["in_progress", "completed", "rejected"],
  in_progress: ["completed", "rejected"],
  completed: [],
  rejected: [],
  cancelled: [],
};

export const ACTIVE_REQUEST_STATUSES: readonly RequestStatus[] = [
  "submitted",
  "acknowledged",
  "in_progress",
];

/** More than this many open at one table is somebody leaning on the button, not a request. */
export const MAX_OPEN_REQUESTS_PER_TABLE = 3;

/** The same request again inside this window is a double-tap, not a second charger. */
export const DUPLICATE_WINDOW_SECONDS = 120;

export function isRequestStatus(value: string): value is RequestStatus {
  return REQUEST_STATUSES.some((candidate) => candidate === value);
}
