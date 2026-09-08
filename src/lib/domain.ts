import { z } from "zod";

export const RULE_VERSION = "evidence-v1";
export const uuid = z.string().uuid();
const value = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((s) => !/[\u0000-\u001f]/u.test(s), "Use a single line");
export const unique = (values: string[]) => [
  ...new Map(
    values.map((s) => [s.trim().toLocaleLowerCase("en"), s.trim()]),
  ).values(),
];
const list = (max: number) => z.array(value).max(max).transform(unique);
export const configSchema = z.object({
  locations: list(20).refine((a) => a.length > 0, "Add a location"),
  roles: list(30).refine((a) => a.length > 0, "Add a role"),
  skills: list(30).default([]),
  requiredKeywords: list(15).default([]),
  queryExclusions: list(20).default([]),
  leadExclusions: list(20).default([]),
  country: z
    .string()
    .regex(/^[a-z]{2}$/)
    .default("in"),
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .default("en"),
  queryCap: z.number().int().min(2).max(20).default(8),
  pageCap: z.number().int().min(1).max(5).default(2),
  budget: z.number().int().min(1).max(50).default(16),
  target: z.number().int().min(1).max(1000).default(25),
  cooldownDays: z.number().int().min(0).max(365).default(30),
  includeRequired: z.boolean().default(false),
});
export type CampaignConfig = z.infer<typeof configSchema>;
export type Query = {
  id?: string;
  text: string;
  strategy: "focused" | "broader" | "custom";
  enabled: boolean;
  signature?: string;
};
export const querySchema = z.object({
  text: z.string().trim().min(1).max(500),
  strategy: z.enum(["focused", "broader", "custom"]),
  enabled: z.boolean(),
});
export const campaignSchema = z.object({
  id: uuid.optional(),
  clientId: uuid,
  name: z.string().trim().min(1).max(120),
  config: configSchema,
  queries: z.array(querySchema).min(1).max(40),
  reset: z.boolean().default(false),
  expectedRevision: z.number().int().min(1).optional(),
});
export type CriterionState = "pass" | "review" | "fail";
export type Evidence = {
  source: "title" | "snippet";
  start: number;
  end: number;
  text: string;
};
export type Criterion = {
  state: CriterionState;
  reason: string;
  spans: Evidence[];
};
export type Assessment = {
  status: "rule_match" | "review" | "rejected";
  conflict?: boolean;
  criteria: Record<"location" | "role" | "skills" | "keywords", Criterion>;
  version: string;
  title: string;
  snippet: string;
  observedAt: string;
};
export type OrganicResult = {
  title: string;
  link: string;
  snippet: string;
  position: number;
};
export const defaults: CampaignConfig = {
  locations: [],
  roles: [],
  skills: [],
  requiredKeywords: [],
  queryExclusions: [],
  leadExclusions: [],
  country: "in",
  language: "en",
  queryCap: 8,
  pageCap: 2,
  budget: 16,
  target: 25,
  cooldownDays: 30,
  includeRequired: false,
};
