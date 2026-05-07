export type AnimateMovement = (
  fromId: string,
  toId: string,
  packetType: string,
  duration: number,
  label?: string,
) => Promise<void>;

export type GraphAnimationContainer = HTMLDivElement & {
  __animateMovement?: AnimateMovement;
};

export function animateOnGraph(
  container: HTMLDivElement | null,
  fromId: string,
  toId: string,
  packetType: string,
  duration: number = 1200,
  label?: string,
): Promise<void> {
  const fn = (container as GraphAnimationContainer | null)?.__animateMovement;
  if (fn) return fn(fromId, toId, packetType, duration, label);
  return Promise.resolve();
}
