export const toNumber = (value: unknown) => Number(value ?? 0);
export const round2 = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
export const round4 = (value: number) =>
  Math.round((value + Number.EPSILON) * 10000) / 10000;
