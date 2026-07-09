export type UserRole = "ADMIN" | "USER";

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
};

export type AuthResponse = {
  accessToken: string;
  expiresInSeconds: number;
  user: CurrentUser;
};
