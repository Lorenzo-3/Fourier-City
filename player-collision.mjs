export function collidesWithCircle(position, circle, padding = 0) {
  if (!circle) return false;

  const dx = position.x - circle.x;
  const dz = position.z - circle.z;
  const collisionRadius = circle.radius + Math.max(0, padding);
  return (dx * dx + dz * dz) <= collisionRadius * collisionRadius;
}
