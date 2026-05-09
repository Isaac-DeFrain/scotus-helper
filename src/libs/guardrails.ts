import { z } from "zod";

export const guardrailsRequestSchema = z.object({
  query: z.string().min(1),
});

export const guardrailsResponseSchema = z.object({
  normalizedQuery: z.string(),
  isOnTopic: z.boolean(),
});

export type GuardrailsResponse = z.infer<typeof guardrailsResponseSchema>;
