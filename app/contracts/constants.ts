export const Session = {
  cookieName: "aew_sid",
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "请先登录",
  insufficientRole: "权限不足",
} as const;

export const Paths = {
  login: "/login",
} as const;
