import { z } from "zod";

/**
 * What each advocate returns. `key_points` exists so judges can credit or reject
 * discrete claims rather than reacting to a wall of prose.
 */
export const SpeechOutput = z.object({
  argument: z.string().min(1).max(8000),
  key_points: z.array(z.string().min(1).max(400)).min(1).max(6),
});
export type SpeechOutput = z.infer<typeof SpeechOutput>;

export const VERDICT_KINDS = ["guilty", "not_guilty", "hung"] as const;

/**
 * What each judge returns. `reasoning` is the protocol entry — the account of how
 * this judge got to its verdict, which is half the point of the whole app.
 */
export const VerdictOutput = z.object({
  verdict: z.enum(VERDICT_KINDS),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(8000),
  points_credited: z.array(z.string().min(1).max(400)).max(8),
  points_rejected: z.array(z.string().min(1).max(400)).max(8),
});
export type VerdictOutput = z.infer<typeof VerdictOutput>;

/** Shape OpenRouter expects under `response_format.json_schema`. */
export interface JsonSchemaSpec {
  name: string;
  strict: boolean;
  schema: Record<string, unknown>;
}

/**
 * Hand-written JSON Schema rather than generated from Zod: OpenRouter's strict mode
 * demands `additionalProperties: false` and every property listed in `required`,
 * and being explicit here beats depending on a generator's output shape.
 */
export const SPEECH_JSON_SCHEMA: JsonSchemaSpec = {
  name: "advocate_speech",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      argument: {
        type: "string",
        description: "The full speech to the tribunal, in this advocate's own voice.",
      },
      key_points: {
        type: "array",
        description: "3-5 discrete claims this speech rests on.",
        items: { type: "string" },
      },
    },
    required: ["argument", "key_points"],
  },
};

export const VERDICT_JSON_SCHEMA: JsonSchemaSpec = {
  name: "judge_verdict",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: {
        type: "string",
        enum: [...VERDICT_KINDS],
        description: "guilty, not_guilty, or hung if genuinely unable to decide.",
      },
      confidence: {
        type: "number",
        description: "How certain this judge is, from 0 to 1.",
      },
      reasoning: {
        type: "string",
        description:
          "The protocol: how this judge reached the verdict, in this judge's own voice.",
      },
      points_credited: {
        type: "array",
        description: "Advocate key points this judge found persuasive.",
        items: { type: "string" },
      },
      points_rejected: {
        type: "array",
        description: "Advocate key points this judge rejected.",
        items: { type: "string" },
      },
    },
    required: [
      "verdict",
      "confidence",
      "reasoning",
      "points_credited",
      "points_rejected",
    ],
  },
};

/** Charge sheet bounds — mirrored by the CHECK constraint in the migration. */
export const CHARGE_SHEET_MIN = 20;
export const CHARGE_SHEET_MAX = 4000;

/** Character bounds. Names are short free text; bodies are written server-side. */
export const PERSONA_NAME_MAX = 120;
export const PERSONA_BODY_MIN = 20;
export const PERSONA_BODY_MAX = 2000;

/**
 * How the cast is chosen.
 *   default — the seven built-in characters
 *   named   — the user names each seat; the backend forges the identity
 *   auto    — the backend invents a cast to suit the charge sheet
 */
export const CHARACTER_MODES = ["default", "named", "auto"] as const;
export type CharacterMode = (typeof CHARACTER_MODES)[number];

/**
 * A seat name supplied by the user. `key` names the SEAT, not the character, so
 * the seven seats always resolve however they are cast. Open text: "Sherlock
 * Holmes", "a tired public defender", "my landlord" all work.
 */
export const CharacterNameInput = z.object({
  key: z.string().max(40),
  name: z.string().trim().min(1).max(PERSONA_NAME_MAX),
});
export type CharacterNameInput = z.infer<typeof CharacterNameInput>;

export const CreateRunInput = z.object({
  charge_sheet: z.string().trim().min(CHARGE_SHEET_MIN).max(CHARGE_SHEET_MAX),
  model_mode: z.enum(["uniform", "per_character"]),
  /** Only honoured in uniform mode; must be on the allow-list. */
  uniform_model_id: z.string().max(120).optional(),
  character_mode: z.enum(CHARACTER_MODES).default("default"),
  /** Only read in `named` mode. */
  character_names: z.array(CharacterNameInput).max(7).optional(),
  access_code: z.string().max(200).optional(),
});
export type CreateRunInput = z.infer<typeof CreateRunInput>;

// ------------------------------------------------------------- the forge

/** One character as written by the forge. */
export const ForgedCharacter = z.object({
  key: z.string().max(40),
  name: z.string().trim().min(1).max(PERSONA_NAME_MAX),
  blurb: z.string().trim().min(1).max(200),
  body: z.string().trim().min(PERSONA_BODY_MIN).max(PERSONA_BODY_MAX),
});
export type ForgedCharacter = z.infer<typeof ForgedCharacter>;

export const ForgedCast = z.object({
  characters: z.array(ForgedCharacter).length(7),
});
export type ForgedCast = z.infer<typeof ForgedCast>;

export const CAST_JSON_SCHEMA: JsonSchemaSpec = {
  name: "tribunal_cast",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      characters: {
        type: "array",
        description: "Exactly seven characters, one per seat, in the order given.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string", description: "The seat id given in the brief." },
            name: { type: "string", description: "The character's display name." },
            blurb: { type: "string", description: "One line describing how they argue." },
            body: {
              type: "string",
              description:
                "Second-person character description used as the system prompt. 100-200 words.",
            },
          },
          required: ["key", "name", "blurb", "body"],
        },
      },
    },
    required: ["characters"],
  },
};
