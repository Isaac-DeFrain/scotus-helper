import { z } from "zod";

import { selectorRequestSchema } from "../api/selector";

export const chatRequestSchema = selectorRequestSchema.extend({
  userId: z.string().min(1).nullable().optional(),
});
