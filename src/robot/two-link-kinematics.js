const EPSILON = 1e-6;

export function solveTwoLinkArm(horizontalDistance, verticalDistance, firstLength, secondLength) {
  const safeFirstLength = Math.max(EPSILON, firstLength);
  const safeSecondLength = Math.max(EPSILON, secondLength);
  const minimumReach = Math.abs(safeFirstLength - safeSecondLength) + EPSILON;
  const maximumReach = safeFirstLength + safeSecondLength - EPSILON;
  const requestedReach = Math.hypot(horizontalDistance, verticalDistance);
  const clampedReach = Math.min(maximumReach, Math.max(minimumReach, requestedReach));
  const direction = requestedReach > EPSILON
    ? {
        horizontal: horizontalDistance / requestedReach,
        vertical: verticalDistance / requestedReach
      }
    : { horizontal: 1, vertical: 0 };
  const horizontal = direction.horizontal * clampedReach;
  const vertical = direction.vertical * clampedReach;
  const elbowCosine = clamp(
    (
      clampedReach * clampedReach
      - safeFirstLength * safeFirstLength
      - safeSecondLength * safeSecondLength
    ) / (2 * safeFirstLength * safeSecondLength),
    -1,
    1
  );
  const elbowAngle = Math.acos(elbowCosine);
  const shoulderAngle = Math.atan2(vertical, horizontal) - Math.atan2(
    safeSecondLength * Math.sin(elbowAngle),
    safeFirstLength + safeSecondLength * elbowCosine
  );

  return {
    shoulderAngle,
    elbowAngle,
    horizontal,
    vertical,
    reach: clampedReach,
    clamped: Math.abs(requestedReach - clampedReach) > EPSILON
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
