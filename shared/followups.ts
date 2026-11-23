import { z } from "zod";

export const FOLLOW_UP_STATUSES = ["open", "won", "lost"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

export const followUpSchema = z.object({
  uid: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().max(20).refine((v) => v === "" || /^[0-9+\- ]{6,20}$/.test(v), "Enter a valid phone number"),
  note: z.string().trim().max(500),
  dueDate: isoDate,
});
export const updateFollowUpSchema = followUpSchema.omit({ uid: true }).extend({
  status: z.enum(FOLLOW_UP_STATUSES),
  updatedAt: z.number().int().nonnegative(),
});
export const followUpListQuery = z.object({
  status: z.enum([...FOLLOW_UP_STATUSES, "all"]).optional().default("open"),
});

export interface FollowUp {
  id: number;
  name: string;
  phone: string;
  note: string;
  dueDate: string;
  status: FollowUpStatus;
  createdAt: number;
  updatedAt: number;
}
