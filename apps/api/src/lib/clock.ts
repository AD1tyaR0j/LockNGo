/** Single time source so tests can move time forward deterministically. */
export const clock = {
  now: (): Date => new Date(),
};

export const addSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
export const addMinutes = (d: Date, m: number) => addSeconds(d, m * 60);
export const addHours = (d: Date, h: number) => addSeconds(d, h * 3600);
