export const MAX_TRACK_DURATION_SEC = 600;

export function shouldSplitForDurationLimit(durationSec) {
  return Number.isFinite(durationSec) && durationSec >= MAX_TRACK_DURATION_SEC;
}
