// Product groups and product units masters (Module 7).
import { z } from "zod";
import { unitCode } from "./masters";

const updatedAt = z.number().int().nonnegative();

export interface ProductGroup {
  id: number;
  name: string;
  isActive: boolean;
  productCount: number;
  updatedAt: number;
}

export const productGroupSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60),
  isActive: z.boolean(),
});
export const updateProductGroupSchema = productGroupSchema.and(z.object({ updatedAt }));

export interface UnitRow {
  code: string;
  name: string;
  isSystem: boolean;
  isActive: boolean;
  productCount: number;
  updatedAt: number;
}

export const unitSchema = z.object({
  code: unitCode,
  name: z.string().trim().min(1, "Enter a name").max(40),
  isActive: z.boolean(),
});
/** The code is fixed once created (products store it). */
export const updateUnitSchema = z.object({ name: unitSchema.shape.name, isActive: z.boolean(), updatedAt });
