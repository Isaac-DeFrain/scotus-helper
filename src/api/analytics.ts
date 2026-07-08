import { z } from "zod";

export const userIdQuerySchema = z.object({
  userId: z.string().min(1).optional(),
});

export const analyticsFilterSchema = userIdQuerySchema.extend({
  since: z.coerce.number().int().optional(),
  until: z.coerce.number().int().optional(),
});

export const listExchangesQuerySchema = analyticsFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const exchangeDetailQuerySchema = userIdQuerySchema;

export const exchangeIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export function parseSearchParams(
  searchParams: URLSearchParams,
): Record<string, string> {
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

export function userScopedSearchParams(userId: string): string {
  return new URLSearchParams({ userId }).toString();
}
