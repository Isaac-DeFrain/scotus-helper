import { v4 as uuidv4 } from "uuid";

export const USER_ID_STORAGE_KEY = "scotus-helper-user-id";

/**
 * Returns a stable anonymous user id, creating one in localStorage when missing.
 */
export function getOrCreateUserId(): string {
  if (typeof window === "undefined") {
    return "server";
  }

  const existing = localStorage.getItem(USER_ID_STORAGE_KEY);
  if (existing) return existing;

  const userId = uuidv4();
  localStorage.setItem(USER_ID_STORAGE_KEY, userId);

  return userId;
}
