import { z } from "zod";

/**
 * What each advocate returns. `key_points` exists so judges can credit or reject
 * discrete claims rather than reacting to a wall of prose.
 */
export const SpeechOutput = z.object({
  argument: z.string().min(1).max(8000),
  key_points: z.array(z.string().min(1).max(400)).min(1).max(6),
  /**
   * The advocate's counterpart to a judge's protocol: how they chose this line of
   * argument. Optional so a run survives a model that omits it.
   */
  reasoning: z.string().max(4000).optional().default(""),
});
export type SpeechOutput = z.infer<typeof SpeechOutput>;

export const VERDICT_KINDS = ["guilty", "not_guilty", "hung"] as const;

/**
 * Models return the right answer in the wrong spelling constantly — "Not Guilty",
 * "NOT_GUILTY", "acquitted". Rejecting those wastes a whole seat over
 * capitalisation, so normalise before validating.
 */
const VERDICT_ALIASES: Record<string, (typeof VERDICT_KINDS)[number]> = {
  guilty: "guilty",
  convicted: "guilty",
  justified: "not_guilty",
  not_guilty: "not_guilty",
  notguilty: "not_guilty",
  innocent: "not_guilty",
  acquitted: "not_guilty",
  not_justified: "guilty",
  hung: "hung",
  undecided: "hung",
  deadlocked: "hung",
  split: "hung",
};

export function normaliseVerdict(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const key = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return VERDICT_ALIASES[key] ?? key;
}

/**
 * What the MODEL is allowed to say — deliberately wider than what is stored.
 *
 * A judge answering a charge sheet framed "justified or not justified?" must be
 * able to answer in those words. Offering only guilty/not_guilty forces it to
 * invert its own conclusion at the moment it writes the token, and "not
 * justified" is lexically pulled straight to "not_guilty" — which means the
 * opposite. Three judges on three different models all made exactly that
 * inversion on the same run: each wrote "the breach was not justified" in its
 * protocol and returned `not_guilty`.
 *
 * The aliases above already understood this vocabulary; strict structured
 * output simply never let a model reach them. Widening the offered enum does.
 * The model now answers in whichever vocabulary the charge sheet used, and the
 * mapping onto the three stored kinds happens here, deterministically, instead
 * of being something a model has to remember to do in its head.
 */
export const VERDICT_CHOICES = [
  "guilty",
  "not_guilty",
  "justified",
  "not_justified",
  "hung",
] as const;

/**
 * The judge's own word, before it is mapped onto a stored kind.
 *
 * Kept only when the judge answered in the offered vocabulary. A model that says
 * "acquitted" still normalises to `not_guilty` for storage, but there is no
 * useful word to quote back, so this is null and the display falls back to the
 * kind.
 */
function verdictAsReturned(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const key = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (VERDICT_CHOICES as readonly string[]).includes(key) ? key : null;
}

/**
 * What each judge returns. `reasoning` is the protocol entry — the account of how
 * this judge got to its verdict, which is half the point of the whole app.
 *
 * The object is preprocessed so one answer yields two things: `verdict`, the
 * kind Postgres stores and everything downstream reasons about, and
 * `verdict_as_returned`, the word the judge actually used. A judge answering a
 * justification-framed charge sheet says "not_justified"; that is stored as
 * `guilty`, which is the right kind and the wrong word to show a reader.
 */
export const VerdictOutput = z.preprocess(
  (raw) =>
    raw && typeof raw === "object" && "verdict" in raw
      ? { ...raw, verdict_as_returned: verdictAsReturned((raw as Record<string, unknown>).verdict) }
      : raw,
  z.object({
    verdict: z.preprocess(normaliseVerdict, z.enum(VERDICT_KINDS)),
    verdict_as_returned: z.enum(VERDICT_CHOICES).nullable().catch(null),
    // Some models send confidence as a string, or as a percentage.
    confidence: z.coerce
      .number()
      .transform((n) => (n > 1 && n <= 100 ? n / 100 : n))
      .pipe(z.number().min(0).max(1))
      .catch(0.5),
    reasoning: z.string().min(1).max(8000),
    points_credited: z.array(z.string().min(1).max(400)).max(8),
    points_rejected: z.array(z.string().min(1).max(400)).max(8),
  }),
);
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
      reasoning: {
        type: "string",
        description:
          "How you chose this line of argument: which facts you leaned on, which you had to work around, and where your case is weakest. Written to the reader, not to the tribunal.",
      },
    },
    required: ["argument", "key_points", "reasoning"],
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
        enum: [...VERDICT_CHOICES],
        description:
          "Answer in the charge sheet's own vocabulary. If it asks guilty / not guilty, return guilty or not_guilty. If it asks justified / not justified, return justified or not_justified — do NOT translate those into guilty/not_guilty yourself. Return hung only if genuinely unable to decide.",
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
 *   dossier — the cast (and charge sheet) come from an uploaded case PDF
 */
export const CHARACTER_MODES = ["default", "named", "auto", "dossier"] as const;
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
  /** Only read in `dossier` mode: the upload whose cast this run should use. */
  dossier_id: z.string().uuid().optional(),
  access_code: z.string().max(200).optional(),
});
export type CreateRunInput = z.infer<typeof CreateRunInput>;

// ------------------------------------------------------------- the forge

/**
 * One character as written by the forge. Bounds are loose for the same reason as
 * DossierCharacter above: clamp after parsing rather than discard a usable cast.
 */
export const ForgedCharacter = z.object({
  key: z.string().max(80),
  name: z.string().trim().min(1).max(400),
  blurb: z.string().trim().min(1).max(1000),
  body: z.string().trim().min(PERSONA_BODY_MIN).max(12_000),
});
export type ForgedCharacter = z.infer<typeof ForgedCharacter>;

export const ForgedCast = z.object({
  characters: z.array(ForgedCharacter).min(1).max(14),
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

// ------------------------------------------------------ dossier extraction

/** Bounds for text pulled out of an uploaded PDF. */
export const DOSSIER_TEXT_MAX = 120_000;
export const DOSSIER_BYTES_MAX = 4 * 1024 * 1024; // Vercel caps request bodies ~4.5MB

/**
 * One seat recovered from an uploaded dossier.
 *
 * The bounds here are deliberately loose. Rejecting a whole extraction because a
 * body ran 2,100 characters instead of 2,000 throws away a perfectly good cast
 * over a formatting detail, and costs another model call to retry. Anything
 * oversized is clamped in lib/dossier.ts once parsing has succeeded.
 */
export const DossierCharacter = z.object({
  key: z.string().max(80),
  name: z.string().trim().min(1).max(400),
  blurb: z.string().trim().min(1).max(1000),
  body: z.string().trim().min(PERSONA_BODY_MIN).max(12_000),
  /** Whether the document actually described this seat, or the model filled a gap. */
  source: z
    .preprocess(
      (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
      z.enum(["extracted", "invented"]),
    )
    .catch("extracted"),
});
export type DossierCharacter = z.infer<typeof DossierCharacter>;

export const DossierExtraction = z.object({
  /** "" when the document contains no usable charge sheet. */
  charge_sheet: z.string().max(30_000),
  case_title: z.string().max(600),
  // Seven is what we ask for; short or long casts are reconciled seat by seat
  // rather than thrown away.
  characters: z.array(DossierCharacter).min(1).max(14),
});
export type DossierExtraction = z.infer<typeof DossierExtraction>;

export const DOSSIER_JSON_SCHEMA: JsonSchemaSpec = {
  name: "case_dossier",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      case_title: {
        type: "string",
        description: "Short title of the case, e.g. 'The Realm v. Jon Snow'. Empty if absent.",
      },
      charge_sheet: {
        type: "string",
        description:
          "The charge sheet as a self-contained brief for the tribunal: accused, act alleged, agreed facts, and the question for judgment. Empty string if the document has none.",
      },
      characters: {
        type: "array",
        description: "Exactly seven characters, one per seat, in the order given.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string", description: "The seat id given in the brief." },
            name: { type: "string", description: "The character's name as the document gives it." },
            blurb: { type: "string", description: "One line describing how they argue or judge." },
            body: {
              type: "string",
              description:
                "Second-person character description used as the system prompt. 100-200 words.",
            },
            source: {
              type: "string",
              enum: ["extracted", "invented"],
              description:
                "'extracted' if the document described this character; 'invented' if you filled an empty seat.",
            },
          },
          required: ["key", "name", "blurb", "body", "source"],
        },
      },
    },
    required: ["case_title", "charge_sheet", "characters"],
  },
};
