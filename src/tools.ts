import openapiSpec from "../docs/bangumi-tv-api.json";
import type { RuntimeConfig } from "./config";
import { requestBangumi, formatBangumiFailure, type BangumiSuccess } from "./lib/bangumi";
import {
  formatCharacterSummary,
  formatCollectionStatus,
  formatEpisodeCollectionStatus,
  formatEpisodeSummary,
  formatItemList,
  formatPersonSummary,
  formatRevisionSummary,
  formatSubjectSummary,
  prettyJson,
} from "./lib/format";

export interface ToolContext {
  authToken: string | null;
  config: RuntimeConfig;
}

export interface ToolResponse {
  ok: boolean;
  text: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  requiresAuth?: boolean;
  handler: (input: Record<string, unknown>, context: ToolContext) => Promise<ToolResponse>;
}

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read: () => Promise<string>;
}

type JsonSchema = Record<string, unknown>;

function schemaString(description: string, enumValues?: readonly string[]): JsonSchema {
  return {
    type: "string",
    description,
    ...(enumValues ? { enum: [...enumValues] } : {}),
  };
}

function schemaNumber(description: string, enumValues?: readonly number[]): JsonSchema {
  return {
    type: "number",
    description,
    ...(enumValues ? { enum: [...enumValues] } : {}),
  };
}

function schemaInteger(
  description: string,
  options: { minimum?: number; maximum?: number; default?: number; enum?: readonly number[] } = {},
): JsonSchema {
  return {
    type: "integer",
    description,
    ...(options.minimum !== undefined ? { minimum: options.minimum } : {}),
    ...(options.maximum !== undefined ? { maximum: options.maximum } : {}),
    ...(options.default !== undefined ? { default: options.default } : {}),
    ...(options.enum ? { enum: [...options.enum] } : {}),
  };
}

function schemaBoolean(description: string): JsonSchema {
  return { type: "boolean", description };
}

function schemaArray(items: JsonSchema, description: string, options: { minItems?: number } = {}): JsonSchema {
  return {
    type: "array",
    description,
    items,
    ...(options.minItems !== undefined ? { minItems: options.minItems } : {}),
  };
}

function schemaObject(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): JsonSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function ok(text: string): ToolResponse {
  return { ok: true, text };
}

function fail(text: string): ToolResponse {
  return { ok: false, text };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown, label: string): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  return value;
}

function toArray(value: unknown, label: string): unknown[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value;
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

function readNumberArray(input: Record<string, unknown>, key: string): number[] | undefined {
  const value = input[key];
  if (!Array.isArray(value)) {
    return undefined;
  }

  const numbers = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  return numbers.length === value.length ? numbers : undefined;
}

function requireAuth(context: ToolContext): string | null {
  return context.authToken ? null : "Authorization: Bearer <token> is required for this tool.";
}

function api(
  context: ToolContext,
  method: string,
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
  body?: unknown,
) {
  return requestBangumi(context.config, context.authToken, { method, path, query, body });
}

function ensureBangumiSuccess(result: Awaited<ReturnType<typeof api>>): BangumiSuccess | null {
  return result.ok ? result : null;
}

function formatCollectionLines(
  title: string,
  items: Array<{ summary: string; status?: string }>,
  total?: number,
): string {
  const lines = [title];
  if (typeof total === "number") {
    lines.push(`Total: ${total}`);
  }
  if (items.length === 0) {
    lines.push("No items found.");
    return lines.join("\n");
  }

  lines.push(
    items
      .map((item) => (item.status ? `${item.summary} - ${item.status}` : item.summary))
      .join("\n---\n"),
  );
  return lines.join("\n");
}

function getDataObject(
  response: BangumiSuccess,
  label: string,
): Record<string, unknown> | null {
  return toRecord(response.data, label);
}

function getDataArray(
  response: BangumiSuccess,
  label: string,
): unknown[] | null {
  return toArray(response.data, label);
}

const subjectTypeEnum = [1, 2, 3, 4, 6] as const;
const subjectSortEnum = ["match", "heat", "rank", "score"] as const;
const personCareerEnum = ["producer", "mangaka", "artist", "seiyu", "writer", "illustrator", "actor"] as const;
const subjectImageTypes = ["small", "grid", "large", "medium", "common"] as const;
const personImageTypes = ["small", "grid", "large", "medium"] as const;
const characterImageTypes = ["small", "grid", "large", "medium"] as const;
const avatarTypes = ["small", "large", "medium"] as const;
const collectionTypeEnum = [1, 2, 3, 4, 5] as const;
const episodeTypeEnum = [0, 1, 2, 3, 4, 5, 6] as const;
const episodeCollectionTypeEnum = [1, 2, 3] as const;

const calendarTool: ToolDefinition = {
  name: "get_daily_broadcast",
  description: "Get the daily broadcast schedule for the current week on Bangumi.",
  inputSchema: schemaObject({}),
  handler: async (_, context) => {
    const result = await api(context, "GET", "/calendar");
    const success = ensureBangumiSuccess(result);
    if (!success) {
      return fail(formatBangumiFailure(result));
    }

    const days = getDataArray(success, "calendar");
    if (!days) {
      return fail("Unexpected response format for calendar.");
    }

    const items = days.map((day) => {
      if (!isRecord(day)) {
        return "Unexpected calendar item format.";
      }
      const weekday = isRecord(day.weekday) ? day.weekday : {};
      const weekdayName =
        readString(weekday, "cn") ?? readString(weekday, "ja") ?? readString(weekday, "en") ?? "Unknown day";
      if (!Array.isArray(day.items)) {
        return "Unexpected calendar item format.";
      }
      const broadcasts = day.items;
      const summaries = broadcasts
        .filter(isRecord)
        .map((subject) => `  ${formatSubjectSummary(subject)}`);
      return [`--- ${weekdayName} ---`, summaries.length > 0 ? summaries.join("\n") : "  No broadcasts scheduled."].join("\n");
    });

    return ok(formatItemList("Daily Broadcast Schedule:", items));
  },
};

const searchSubjectsTool: ToolDefinition = {
  name: "search_subjects",
  description: "Search for Bangumi subjects.",
  inputSchema: schemaObject({
    keyword: schemaString("Search keyword"),
    subject_type: schemaNumber("Optional subject type filter", subjectTypeEnum),
    sort: schemaString("Sort order", subjectSortEnum),
    limit: schemaInteger("Pagination limit", { minimum: 1, maximum: 50, default: 30 }),
    offset: schemaInteger("Pagination offset", { minimum: 0, default: 0 }),
  }, ["keyword"]),
  handler: async (input, context) => {
    const keyword = readString(input, "keyword");
    if (!keyword) {
      return fail("keyword is required.");
    }

    const subjectType = readNumber(input, "subject_type");
    const sort = readString(input, "sort") ?? "match";
    const limit = Math.min(readNumber(input, "limit") ?? 30, 50);
    const offset = readNumber(input, "offset") ?? 0;

    const payload: Record<string, unknown> = { keyword, sort, filter: {} };
    if (subjectType !== undefined) {
      (payload.filter as Record<string, unknown>).type = [subjectType];
    }

    const result = await api(context, "POST", "/v0/search/subjects", { limit, offset }, payload);
    const success = ensureBangumiSuccess(result);
    if (!success) {
      return fail(formatBangumiFailure(result));
    }

    const data = getDataObject(success, "search_subjects");
    if (!data) {
      return fail("Unexpected response format for search_subjects.");
    }

    if (!Array.isArray(data.data)) return fail("Unexpected response format for search_subjects.");
    const items = data.data.filter(isRecord).map(formatSubjectSummary);
    return ok(formatItemList(`Found ${items.length} subjects.`, items, readNumber(data, "total")));
  },
};

const browseSubjectsTool: ToolDefinition = {
  name: "browse_subjects",
  description: "Browse Bangumi subjects by type and filters.",
  inputSchema: schemaObject({
    subject_type: schemaNumber("Subject type", subjectTypeEnum),
    cat: schemaInteger("Category filter"),
    series: schemaBoolean("Book series filter"),
    platform: schemaString("Platform filter"),
    sort: schemaString("Sort order"),
    year: schemaInteger("Year"),
    month: schemaInteger("Month"),
    limit: schemaInteger("Pagination limit", { minimum: 1, maximum: 50, default: 30 }),
    offset: schemaInteger("Pagination offset", { minimum: 0, default: 0 }),
  }, ["subject_type"]),
  handler: async (input, context) => {
    const subjectType = readNumber(input, "subject_type");
    if (subjectType === undefined) {
      return fail("subject_type is required.");
    }

    const query: Record<string, string | number | boolean | null | undefined> = {
      type: subjectType,
      limit: Math.min(readNumber(input, "limit") ?? 30, 50),
      offset: readNumber(input, "offset") ?? 0,
    };

    const cat = readNumber(input, "cat");
    const series = readBoolean(input, "series");
    const platform = readString(input, "platform");
    const sort = readString(input, "sort");
    const year = readNumber(input, "year");
    const month = readNumber(input, "month");

    if (cat !== undefined) query.cat = cat;
    if (series !== undefined) query.series = series;
    if (platform !== undefined) query.platform = platform;
    if (sort !== undefined) query.sort = sort;
    if (year !== undefined) query.year = year;
    if (month !== undefined) query.month = month;

    const result = await api(context, "GET", "/v0/subjects", query);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success, "browse_subjects");
    if (!data) return fail("Unexpected response format for browse_subjects.");

    if (!Array.isArray(data.data)) return fail("Unexpected response format for browse_subjects.");
    const items = data.data.filter(isRecord).map(formatSubjectSummary);
    return ok(formatItemList("Browse results:", items, readNumber(data, "total")));
  },
};

const getSubjectDetailsTool: ToolDefinition = {
  name: "get_subject_details",
  description: "Get details of a Bangumi subject.",
  inputSchema: schemaObject({ subject_id: schemaInteger("Subject ID", { minimum: 1 }) }, ["subject_id"]),
  handler: async (input, context) => {
    const subjectId = readNumber(input, "subject_id");
    if (subjectId === undefined) return fail("subject_id is required.");

    const result = await api(context, "GET", `/v0/subjects/${subjectId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    return ok(`Subject details:\n${prettyJson(success.data)}`);
  },
};

const getSubjectImageTool: ToolDefinition = {
  name: "get_subject_image",
  description: "Get the subject image URL.",
  inputSchema: schemaObject({
    subject_id: schemaInteger("Subject ID", { minimum: 1 }),
    image_type: schemaString("Image type", subjectImageTypes),
  }, ["subject_id"]),
  handler: async (input, context) => {
    const subjectId = readNumber(input, "subject_id");
    if (subjectId === undefined) return fail("subject_id is required.");

    const imageType = readString(input, "image_type") ?? "large";
    if (!subjectImageTypes.includes(imageType as (typeof subjectImageTypes)[number])) {
      return fail(`Invalid image_type: ${imageType}.`);
    }

    const result = await api(context, "GET", `/v0/subjects/${subjectId}/image`, { type: imageType });
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Subject image URL: ${success.location ?? "Unavailable"}`);
  },
};

const getSubjectPersonsTool: ToolDefinition = {
  name: "get_subject_persons",
  description: "List persons related to a subject.",
  inputSchema: schemaObject({ subject_id: schemaInteger("Subject ID", { minimum: 1 }) }, ["subject_id"]),
  handler: async (input, context) => {
    const subjectId = readNumber(input, "subject_id");
    if (subjectId === undefined) return fail("subject_id is required.");

    const result = await api(context, "GET", `/v0/subjects/${subjectId}/persons`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const items = getDataArray(success, "subject persons");
    if (!items) return fail("Unexpected response format for subject persons.");
    const summaries = items.filter(isRecord).map(formatPersonSummary);
    return ok(formatItemList("Related Persons:", summaries));
  },
};

const getSubjectCharactersTool: ToolDefinition = {
  name: "get_subject_characters",
  description: "List characters related to a subject.",
  inputSchema: schemaObject({ subject_id: schemaInteger("Subject ID", { minimum: 1 }) }, ["subject_id"]),
  handler: async (input, context) => {
    const subjectId = readNumber(input, "subject_id");
    if (subjectId === undefined) return fail("subject_id is required.");

    const result = await api(context, "GET", `/v0/subjects/${subjectId}/characters`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const items = getDataArray(success, "subject characters");
    if (!items) return fail("Unexpected response format for subject characters.");
    const summaries = items.filter(isRecord).map(formatCharacterSummary);
    return ok(formatItemList("Related Characters:", summaries));
  },
};

const getSubjectRelationsTool: ToolDefinition = {
  name: "get_subject_relations",
  description: "List related subjects for a subject.",
  inputSchema: schemaObject({ subject_id: schemaInteger("Subject ID", { minimum: 1 }) }, ["subject_id"]),
  handler: async (input, context) => {
    const subjectId = readNumber(input, "subject_id");
    if (subjectId === undefined) return fail("subject_id is required.");

    const result = await api(context, "GET", `/v0/subjects/${subjectId}/subjects`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const items = getDataArray(success, "subject relations");
    if (!items) return fail("Unexpected response format for subject relations.");
    const summaries = items.filter(isRecord).map(formatSubjectSummary);
    return ok(formatItemList("Related Subjects:", summaries));
  },
};

const getEpisodesTool: ToolDefinition = {
  name: "get_episodes",
  description: "List episodes for a subject.",
  inputSchema: schemaObject({
    subject_id: schemaInteger("Subject ID", { minimum: 1 }),
    episode_type: schemaNumber("Episode type", episodeTypeEnum),
    limit: schemaInteger("Pagination limit", { minimum: 1, maximum: 200, default: 100 }),
    offset: schemaInteger("Pagination offset", { minimum: 0, default: 0 }),
  }, ["subject_id"]),
  handler: async (input, context) => {
    const subjectId = readNumber(input, "subject_id");
    if (subjectId === undefined) return fail("subject_id is required.");

    const query: Record<string, string | number | boolean | null | undefined> = {
      subject_id: subjectId,
      limit: Math.min(readNumber(input, "limit") ?? 100, 200),
      offset: readNumber(input, "offset") ?? 0,
    };
    const episodeType = readNumber(input, "episode_type");
    if (episodeType !== undefined) query.type = episodeType;

    const result = await api(context, "GET", "/v0/episodes", query);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success, "episodes");
    if (!data) return fail("Unexpected response format for episodes.");
    if (!Array.isArray(data.data)) return fail("Unexpected response format for episodes.");
    const items = data.data.filter(isRecord).map(formatEpisodeSummary);
    return ok(formatItemList("Episodes:", items, readNumber(data, "total")));
  },
};

const getEpisodeDetailsTool: ToolDefinition = {
  name: "get_episode_details",
  description: "Get details of a Bangumi episode.",
  inputSchema: schemaObject({ episode_id: schemaInteger("Episode ID", { minimum: 1 }) }, ["episode_id"]),
  handler: async (input, context) => {
    const episodeId = readNumber(input, "episode_id");
    if (episodeId === undefined) return fail("episode_id is required.");

    const result = await api(context, "GET", `/v0/episodes/${episodeId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    return ok(`Episode details:\n${prettyJson(success.data)}`);
  },
};

const searchPersonsTool: ToolDefinition = {
  name: "search_persons",
  description: "Search for Bangumi persons or companies.",
  inputSchema: schemaObject({
    keyword: schemaString("Search keyword"),
    limit: schemaInteger("Pagination limit", { minimum: 1, default: 30 }),
    offset: schemaInteger("Pagination offset", { minimum: 0, default: 0 }),
    career_filter: schemaArray(schemaString("Career filter", personCareerEnum), "Career filter list"),
  }, ["keyword"]),
  handler: async (input, context) => {
    const keyword = readString(input, "keyword");
    if (!keyword) return fail("keyword is required.");

    const limit = readNumber(input, "limit") ?? 30;
    const offset = readNumber(input, "offset") ?? 0;
    const careerFilter = Array.isArray(input.career_filter)
      ? input.career_filter.filter((item): item is string => typeof item === "string" && item.length > 0)
      : undefined;

    const payload: Record<string, unknown> = { keyword, filter: {} };
    if (careerFilter && careerFilter.length > 0) {
      (payload.filter as Record<string, unknown>).career = careerFilter;
    }

    const result = await api(context, "POST", "/v0/search/persons", { limit, offset }, payload);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success, "search persons");
    if (!data) return fail("Unexpected response format for search persons.");
    if (!Array.isArray(data.data)) return fail("Unexpected response format for search persons.");
    const items = data.data.filter(isRecord).map(formatPersonSummary);
    return ok(formatItemList(`Found ${items.length} persons.`, items, readNumber(data, "total")));
  },
};

const getPersonDetailsTool: ToolDefinition = {
  name: "get_person_details",
  description: "Get details of a Bangumi person or company.",
  inputSchema: schemaObject({ person_id: schemaInteger("Person ID", { minimum: 1 }) }, ["person_id"]),
  handler: async (input, context) => {
    const personId = readNumber(input, "person_id");
    if (personId === undefined) return fail("person_id is required.");

    const result = await api(context, "GET", `/v0/persons/${personId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    return ok(`Person details:\n${prettyJson(success.data)}`);
  },
};

const getPersonSubjectsTool: ToolDefinition = {
  name: "get_person_subjects",
  description: "List subjects related to a person.",
  inputSchema: schemaObject({ person_id: schemaInteger("Person ID", { minimum: 1 }) }, ["person_id"]),
  handler: async (input, context) => {
    const personId = readNumber(input, "person_id");
    if (personId === undefined) return fail("person_id is required.");

    const result = await api(context, "GET", `/v0/persons/${personId}/subjects`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const items = getDataArray(success, "person subjects");
    if (!items) return fail("Unexpected response format for person subjects.");
    const summaries = items.filter(isRecord).map(formatSubjectSummary);
    return ok(formatItemList("Related Subjects:", summaries));
  },
};

const getPersonCharactersTool: ToolDefinition = {
  name: "get_person_characters",
  description: "List characters related to a person.",
  inputSchema: schemaObject({ person_id: schemaInteger("Person ID", { minimum: 1 }) }, ["person_id"]),
  handler: async (input, context) => {
    const personId = readNumber(input, "person_id");
    if (personId === undefined) return fail("person_id is required.");

    const result = await api(context, "GET", `/v0/persons/${personId}/characters`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const items = getDataArray(success, "person characters");
    if (!items) return fail("Unexpected response format for person characters.");
    const summaries = items.filter(isRecord).map(formatCharacterSummary);
    return ok(formatItemList("Related Characters:", summaries));
  },
};

const getPersonImageTool: ToolDefinition = {
  name: "get_person_image",
  description: "Get the person image URL.",
  inputSchema: schemaObject({
    person_id: schemaInteger("Person ID", { minimum: 1 }),
    image_type: schemaString("Image type", personImageTypes),
  }, ["person_id"]),
  handler: async (input, context) => {
    const personId = readNumber(input, "person_id");
    if (personId === undefined) return fail("person_id is required.");

    const imageType = readString(input, "image_type") ?? "large";
    if (!personImageTypes.includes(imageType as (typeof personImageTypes)[number])) {
      return fail(`Invalid image_type: ${imageType}.`);
    }

    const result = await api(context, "GET", `/v0/persons/${personId}/image`, { type: imageType });
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Person image URL: ${success.location ?? "Unavailable"}`);
  },
};

const searchCharactersTool: ToolDefinition = {
  name: "search_characters",
  description: "Search for Bangumi characters.",
  inputSchema: schemaObject({
    keyword: schemaString("Search keyword"),
    limit: schemaInteger("Pagination limit", { minimum: 1, default: 30 }),
    offset: schemaInteger("Pagination offset", { minimum: 0, default: 0 }),
    nsfw_filter: schemaBoolean("Optional NSFW filter"),
  }, ["keyword"]),
  handler: async (input, context) => {
    const keyword = readString(input, "keyword");
    if (!keyword) return fail("keyword is required.");

    const nsfwFilter = readBoolean(input, "nsfw_filter");
    if (nsfwFilter !== undefined && !context.authToken) {
      return fail("nsfw_filter requires Authorization: Bearer <token>.");
    }

    const payload: Record<string, unknown> = { keyword, filter: {} };
    if (nsfwFilter !== undefined) {
      (payload.filter as Record<string, unknown>).nsfw = nsfwFilter;
    }

    const result = await api(context, "POST", "/v0/search/characters", {
      limit: readNumber(input, "limit") ?? 30,
      offset: readNumber(input, "offset") ?? 0,
    }, payload);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success, "search characters");
    if (!data) return fail("Unexpected response format for search characters.");
    if (!Array.isArray(data.data)) return fail("Unexpected response format for search characters.");
    const items = data.data.filter(isRecord).map(formatCharacterSummary);
    return ok(formatItemList(`Found ${items.length} characters.`, items, readNumber(data, "total")));
  },
};

const getCharacterDetailsTool: ToolDefinition = {
  name: "get_character_details",
  description: "Get details of a Bangumi character.",
  inputSchema: schemaObject({ character_id: schemaInteger("Character ID", { minimum: 1 }) }, ["character_id"]),
  handler: async (input, context) => {
    const characterId = readNumber(input, "character_id");
    if (characterId === undefined) return fail("character_id is required.");

    const result = await api(context, "GET", `/v0/characters/${characterId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    return ok(`Character details:\n${prettyJson(success.data)}`);
  },
};

const getCharacterImageTool: ToolDefinition = {
  name: "get_character_image",
  description: "Get the character image URL.",
  inputSchema: schemaObject({
    character_id: schemaInteger("Character ID", { minimum: 1 }),
    image_type: schemaString("Image type", characterImageTypes),
  }, ["character_id"]),
  handler: async (input, context) => {
    const characterId = readNumber(input, "character_id");
    if (characterId === undefined) return fail("character_id is required.");

    const imageType = readString(input, "image_type") ?? "large";
    if (!characterImageTypes.includes(imageType as (typeof characterImageTypes)[number])) {
      return fail(`Invalid image_type: ${imageType}.`);
    }

    const result = await api(context, "GET", `/v0/characters/${characterId}/image`, { type: imageType });
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Character image URL: ${success.location ?? "Unavailable"}`);
  },
};

const getCharacterSubjectsTool: ToolDefinition = {
  name: "get_character_subjects",
  description: "List subjects related to a character.",
  inputSchema: schemaObject({ character_id: schemaInteger("Character ID", { minimum: 1 }) }, ["character_id"]),
  handler: async (input, context) => {
    const characterId = readNumber(input, "character_id");
    if (characterId === undefined) return fail("character_id is required.");

    const result = await api(context, "GET", `/v0/characters/${characterId}/subjects`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const items = getDataArray(success, "character subjects");
    if (!items) return fail("Unexpected response format for character subjects.");
    const summaries = items.map((item) => {
      if (!isRecord(item)) {
        return "Unexpected subject item format.";
      }
      return formatSubjectSummary(item);
    });
    return ok(formatItemList("Subjects this character appears in:", summaries));
  },
};

const getCharacterPersonsTool: ToolDefinition = {
  name: "get_character_persons",
  description: "List persons related to a character.",
  inputSchema: schemaObject({ character_id: schemaInteger("Character ID", { minimum: 1 }) }, ["character_id"]),
  handler: async (input, context) => {
    const characterId = readNumber(input, "character_id");
    if (characterId === undefined) return fail("character_id is required.");

    const result = await api(context, "GET", `/v0/characters/${characterId}/persons`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const items = getDataArray(success, "character persons");
    if (!items) return fail("Unexpected response format for character persons.");
    const summaries = items.filter(isRecord).map(formatPersonSummary);
    return ok(formatItemList("Persons related to this character:", summaries));
  },
};

const collectCharacterTool: ToolDefinition = {
  name: "collect_character",
  description: "Collect a character for the current user.",
  requiresAuth: true,
  inputSchema: schemaObject({ character_id: schemaInteger("Character ID", { minimum: 1 }) }, ["character_id"]),
  handler: async (input, context) => {
    const characterId = readNumber(input, "character_id");
    if (characterId === undefined) return fail("character_id is required.");

    const result = await api(context, "POST", `/v0/characters/${characterId}/collect`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully collected character ${characterId}.`);
  },
};

const uncollectCharacterTool: ToolDefinition = {
  name: "uncollect_character",
  description: "Remove a character from the current user's collection.",
  requiresAuth: true,
  inputSchema: schemaObject({ character_id: schemaInteger("Character ID", { minimum: 1 }) }, ["character_id"]),
  handler: async (input, context) => {
    const characterId = readNumber(input, "character_id");
    if (characterId === undefined) return fail("character_id is required.");

    const result = await api(context, "DELETE", `/v0/characters/${characterId}/collect`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully uncollected character ${characterId}.`);
  },
};

const getUserInfoTool: ToolDefinition = {
  name: "get_user_info",
  description: "Get Bangumi user information by username.",
  inputSchema: schemaObject({ username: schemaString("Username") }, ["username"]),
  handler: async (input, context) => {
    const username = readString(input, "username");
    if (!username) return fail("username is required.");

    const result = await api(context, "GET", `/v0/users/${username}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`User details:\n${prettyJson(success.data)}`);
  },
};

const getUserAvatarTool: ToolDefinition = {
  name: "get_user_avatar",
  description: "Get a Bangumi user's avatar URL.",
  inputSchema: schemaObject({
    username: schemaString("Username"),
    avatar_type: schemaString("Avatar type", avatarTypes),
  }, ["username"]),
  handler: async (input, context) => {
    const username = readString(input, "username");
    if (!username) return fail("username is required.");

    const avatarType = readString(input, "avatar_type") ?? "large";
    if (!avatarTypes.includes(avatarType as (typeof avatarTypes)[number])) {
      return fail(`Invalid avatar_type: ${avatarType}.`);
    }

    const result = await api(context, "GET", `/v0/users/${username}/avatar`, { type: avatarType });
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`User avatar URL: ${success.location ?? "Unavailable"}`);
  },
};

const getCurrentUserTool: ToolDefinition = {
  name: "get_current_user",
  description: "Get the current authenticated user's information.",
  requiresAuth: true,
  inputSchema: schemaObject({}),
  handler: async (_, context) => {
    const result = await api(context, "GET", "/v0/me");
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Current user:\n${prettyJson(success.data)}`);
  },
};

const getUserCollectionsTool: ToolDefinition = {
  name: "get_user_collections",
  description: "List a user's collections.",
  inputSchema: schemaObject({
    username: schemaString("Username"),
    subject_type: schemaNumber("Subject type", subjectTypeEnum),
    collection_type: schemaNumber("Collection type", collectionTypeEnum),
    limit: schemaInteger("Pagination limit", { minimum: 1, maximum: 50, default: 30 }),
    offset: schemaInteger("Pagination offset", { minimum: 0, default: 0 }),
  }, ["username"]),
  handler: async (input, context) => {
    const username = readString(input, "username");
    if (!username) return fail("username is required.");

    const query: Record<string, string | number | boolean | null | undefined> = {
      limit: Math.min(readNumber(input, "limit") ?? 30, 50),
      offset: readNumber(input, "offset") ?? 0,
    };
    const subjectType = readNumber(input, "subject_type");
    const collectionType = readNumber(input, "collection_type");
    if (subjectType !== undefined) query.subject_type = subjectType;
    if (collectionType !== undefined) query.type = collectionType;

    const result = await api(context, "GET", `/v0/users/${username}/collections`, query);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success, "user collections");
    if (!data) return fail("Unexpected response format for user collections.");
    if (!Array.isArray(data.data)) return fail("Unexpected response format for user collections.");
    const items = data.data.filter(isRecord);
    const summaries = items.map((item) => {
      const subject = isRecord(item.subject) ? item.subject : {};
      return {
        summary: formatSubjectSummary(subject),
        status: formatCollectionStatus(item.type),
      };
    });
    return ok(formatCollectionLines(`Collections for user ${username}:`, summaries, readNumber(data, "total")));
  },
};

const getUserSubjectCollectionTool: ToolDefinition = {
  name: "get_user_subject_collection",
  description: "Get a user's collection status for a subject.",
  inputSchema: schemaObject({
    username: schemaString("Username"),
    subject_id: schemaInteger("Subject ID", { minimum: 1 }),
  }, ["username", "subject_id"]),
  handler: async (input, context) => {
    const username = readString(input, "username");
    const subjectId = readNumber(input, "subject_id");
    if (!username) return fail("username is required.");
    if (subjectId === undefined) return fail("subject_id is required.");

    const result = await api(context, "GET", `/v0/users/${username}/collections/${subjectId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Collection details:\n${prettyJson(success.data)}`);
  },
};

const updateSubjectCollectionTool: ToolDefinition = {
  name: "update_subject_collection",
  description: "Update the authenticated user's collection for a subject.",
  requiresAuth: true,
  inputSchema: schemaObject({
    subject_id: schemaInteger("Subject ID", { minimum: 1 }),
    collection_type: schemaNumber("Collection type", collectionTypeEnum),
    ep_status: schemaInteger("Episode status"),
    vol_status: schemaInteger("Volume status"),
    rating: schemaInteger("Rating"),
    comment: schemaString("Comment"),
  }, ["subject_id"]),
  handler: async (input, context) => {
    const subjectId = readNumber(input, "subject_id");
    if (subjectId === undefined) return fail("subject_id is required.");

    const body: Record<string, unknown> = {};
    const collectionType = readNumber(input, "collection_type");
    const epStatus = readNumber(input, "ep_status");
    const volStatus = readNumber(input, "vol_status");
    const rating = readNumber(input, "rating");
    const comment = readString(input, "comment");
    if (collectionType !== undefined) body.type = collectionType;
    if (epStatus !== undefined) body.ep_status = epStatus;
    if (volStatus !== undefined) body.vol_status = volStatus;
    if (rating !== undefined) body.rate = rating;
    if (comment !== undefined) body.comment = comment;

    if (Object.keys(body).length === 0) {
      return fail("Provide at least one field to update.");
    }

    const result = await api(context, "POST", `/v0/users/-/collections/${subjectId}`, undefined, body);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully updated collection for subject ${subjectId}.`);
  },
};

const getUserEpisodeCollectionTool: ToolDefinition = {
  name: "get_user_episode_collection",
  description: "Get the authenticated user's episode collection for a subject.",
  requiresAuth: true,
  inputSchema: schemaObject({
    subject_id: schemaInteger("Subject ID", { minimum: 1 }),
    episode_type: schemaNumber("Episode type", episodeTypeEnum),
    limit: schemaInteger("Pagination limit", { minimum: 1, maximum: 1000, default: 100 }),
    offset: schemaInteger("Pagination offset", { minimum: 0, default: 0 }),
  }, ["subject_id"]),
  handler: async (input, context) => {
    const subjectId = readNumber(input, "subject_id");
    if (subjectId === undefined) return fail("subject_id is required.");

    const query: Record<string, string | number | boolean | null | undefined> = {
      limit: Math.min(readNumber(input, "limit") ?? 100, 1000),
      offset: readNumber(input, "offset") ?? 0,
    };
    const episodeType = readNumber(input, "episode_type");
    if (episodeType !== undefined) query.episode_type = episodeType;

    const result = await api(context, "GET", `/v0/users/-/collections/${subjectId}/episodes`, query);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success, "user episode collection");
    if (!data) return fail("Unexpected response format for user episode collection.");
    if (!Array.isArray(data.data)) return fail("Unexpected response format for user episode collection.");
    const items = data.data.filter(isRecord);
    const summaries = items.map((item) => {
      const episode = isRecord(item.episode) ? item.episode : {};
      return {
        summary: formatEpisodeSummary(episode),
        status: formatEpisodeCollectionStatus(item.type),
      };
    });
    return ok(formatCollectionLines(`Episode collection for subject ${subjectId}:`, summaries, readNumber(data, "total")));
  },
};

const updateEpisodeCollectionTool: ToolDefinition = {
  name: "update_episode_collection",
  description: "Update the authenticated user's collection for multiple episodes.",
  requiresAuth: true,
  inputSchema: schemaObject({
    subject_id: schemaInteger("Subject ID", { minimum: 1 }),
    episode_ids: schemaArray(schemaInteger("Episode ID", { minimum: 1 }), "Episode IDs", { minItems: 1 }),
    collection_type: schemaNumber("Collection type", episodeCollectionTypeEnum),
  }, ["subject_id", "episode_ids"]),
  handler: async (input, context) => {
    const subjectId = readNumber(input, "subject_id");
    const episodeIds = readNumberArray(input, "episode_ids");
    if (subjectId === undefined) return fail("subject_id is required.");
    if (!episodeIds || episodeIds.length === 0) return fail("episode_ids must contain at least one episode ID.");

    const body = {
      episode_id: episodeIds,
      type: readNumber(input, "collection_type") ?? 2,
    };

    const result = await api(context, "PATCH", `/v0/users/-/collections/${subjectId}/episodes`, undefined, body);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully updated ${episodeIds.length} episode collections.`);
  },
};

const getSingleEpisodeCollectionTool: ToolDefinition = {
  name: "get_single_episode_collection",
  description: "Get the authenticated user's collection for a single episode.",
  requiresAuth: true,
  inputSchema: schemaObject({ episode_id: schemaInteger("Episode ID", { minimum: 1 }) }, ["episode_id"]),
  handler: async (input, context) => {
    const episodeId = readNumber(input, "episode_id");
    if (episodeId === undefined) return fail("episode_id is required.");

    const result = await api(context, "GET", `/v0/users/-/collections/-/episodes/${episodeId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Episode collection details:\n${prettyJson(success.data)}`);
  },
};

const updateSingleEpisodeCollectionTool: ToolDefinition = {
  name: "update_single_episode_collection",
  description: "Update the authenticated user's collection for a single episode.",
  requiresAuth: true,
  inputSchema: schemaObject({
    episode_id: schemaInteger("Episode ID", { minimum: 1 }),
    collection_type: schemaNumber("Collection type", episodeCollectionTypeEnum),
  }, ["episode_id"]),
  handler: async (input, context) => {
    const episodeId = readNumber(input, "episode_id");
    if (episodeId === undefined) return fail("episode_id is required.");

    const body = { type: readNumber(input, "collection_type") ?? 2 };
    const result = await api(context, "PUT", `/v0/users/-/collections/-/episodes/${episodeId}`, undefined, body);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully updated episode ${episodeId}.`);
  },
};

const getUserCharacterCollectionsTool: ToolDefinition = {
  name: "get_user_character_collections",
  description: "List a user's collected characters.",
  inputSchema: schemaObject({ username: schemaString("Username") }, ["username"]),
  handler: async (input, context) => {
    const username = readString(input, "username");
    if (!username) return fail("username is required.");

    const result = await api(context, "GET", `/v0/users/${username}/collections/-/characters`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success, "user character collections");
    if (!data) return fail("Unexpected response format for user character collections.");
    if (!Array.isArray(data.data)) return fail("Unexpected response format for user character collections.");
    const items = data.data.filter(isRecord);
    const summaries = items.map((item) => formatCharacterSummary(item));
    return ok(formatItemList(`Character collections for ${username}:`, summaries, readNumber(data, "total")));
  },
};

const getUserCharacterCollectionTool: ToolDefinition = {
  name: "get_user_character_collection",
  description: "Get a user's collected character entry.",
  inputSchema: schemaObject({
    username: schemaString("Username"),
    character_id: schemaInteger("Character ID", { minimum: 1 }),
  }, ["username", "character_id"]),
  handler: async (input, context) => {
    const username = readString(input, "username");
    const characterId = readNumber(input, "character_id");
    if (!username) return fail("username is required.");
    if (characterId === undefined) return fail("character_id is required.");

    const result = await api(context, "GET", `/v0/users/${username}/collections/-/characters/${characterId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Character collection details:\n${prettyJson(success.data)}`);
  },
};

const getUserPersonCollectionsTool: ToolDefinition = {
  name: "get_user_person_collections",
  description: "List a user's collected persons.",
  inputSchema: schemaObject({ username: schemaString("Username") }, ["username"]),
  handler: async (input, context) => {
    const username = readString(input, "username");
    if (!username) return fail("username is required.");

    const result = await api(context, "GET", `/v0/users/${username}/collections/-/persons`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success, "user person collections");
    if (!data) return fail("Unexpected response format for user person collections.");
    if (!Array.isArray(data.data)) return fail("Unexpected response format for user person collections.");
    const items = data.data.filter(isRecord);
    const summaries = items.map((item) => formatPersonSummary(item));
    return ok(formatItemList(`Person collections for ${username}:`, summaries, readNumber(data, "total")));
  },
};

const getUserPersonCollectionTool: ToolDefinition = {
  name: "get_user_person_collection",
  description: "Get a user's collected person entry.",
  inputSchema: schemaObject({
    username: schemaString("Username"),
    person_id: schemaInteger("Person ID", { minimum: 1 }),
  }, ["username", "person_id"]),
  handler: async (input, context) => {
    const username = readString(input, "username");
    const personId = readNumber(input, "person_id");
    if (!username) return fail("username is required.");
    if (personId === undefined) return fail("person_id is required.");

    const result = await api(context, "GET", `/v0/users/${username}/collections/-/persons/${personId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Person collection details:\n${prettyJson(success.data)}`);
  },
};

const collectPersonTool: ToolDefinition = {
  name: "collect_person",
  description: "Collect a person for the current user.",
  requiresAuth: true,
  inputSchema: schemaObject({ person_id: schemaInteger("Person ID", { minimum: 1 }) }, ["person_id"]),
  handler: async (input, context) => {
    const personId = readNumber(input, "person_id");
    if (personId === undefined) return fail("person_id is required.");

    const result = await api(context, "POST", `/v0/persons/${personId}/collect`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully collected person ${personId}.`);
  },
};

const uncollectPersonTool: ToolDefinition = {
  name: "uncollect_person",
  description: "Remove a person from the current user's collection.",
  requiresAuth: true,
  inputSchema: schemaObject({ person_id: schemaInteger("Person ID", { minimum: 1 }) }, ["person_id"]),
  handler: async (input, context) => {
    const personId = readNumber(input, "person_id");
    if (personId === undefined) return fail("person_id is required.");

    const result = await api(context, "DELETE", `/v0/persons/${personId}/collect`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully uncollected person ${personId}.`);
  },
};

const collectIndexTool: ToolDefinition = {
  name: "collect_index",
  description: "Collect an index for the current user.",
  requiresAuth: true,
  inputSchema: schemaObject({ index_id: schemaInteger("Index ID", { minimum: 1 }) }, ["index_id"]),
  handler: async (input, context) => {
    const indexId = readNumber(input, "index_id");
    if (indexId === undefined) return fail("index_id is required.");

    const result = await api(context, "POST", `/v0/indices/${indexId}/collect`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully collected index ${indexId}.`);
  },
};

const uncollectIndexTool: ToolDefinition = {
  name: "uncollect_index",
  description: "Remove an index from the current user's collection.",
  requiresAuth: true,
  inputSchema: schemaObject({ index_id: schemaInteger("Index ID", { minimum: 1 }) }, ["index_id"]),
  handler: async (input, context) => {
    const indexId = readNumber(input, "index_id");
    if (indexId === undefined) return fail("index_id is required.");

    const result = await api(context, "DELETE", `/v0/indices/${indexId}/collect`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully uncollected index ${indexId}.`);
  },
};

const createIndexTool: ToolDefinition = {
  name: "create_index",
  description: "Create a Bangumi index.",
  requiresAuth: true,
  inputSchema: schemaObject({
    title: schemaString("Title"),
    description: schemaString("Description"),
  }, ["title", "description"]),
  handler: async (input, context) => {
    const title = readString(input, "title");
    const description = readString(input, "description");
    if (!title) return fail("title is required.");
    if (!description) return fail("description is required.");

    const result = await api(context, "POST", "/v0/indices", undefined, { title, description });
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully created index:\n${prettyJson(success.data)}`);
  },
};

const getIndexTool: ToolDefinition = {
  name: "get_index",
  description: "Get Bangumi index details.",
  inputSchema: schemaObject({ index_id: schemaInteger("Index ID", { minimum: 1 }) }, ["index_id"]),
  handler: async (input, context) => {
    const indexId = readNumber(input, "index_id");
    if (indexId === undefined) return fail("index_id is required.");

    const result = await api(context, "GET", `/v0/indices/${indexId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Index details:\n${prettyJson(success.data)}`);
  },
};

const updateIndexTool: ToolDefinition = {
  name: "update_index",
  description: "Update a Bangumi index.",
  requiresAuth: true,
  inputSchema: schemaObject({
    index_id: schemaInteger("Index ID", { minimum: 1 }),
    title: schemaString("Title"),
    description: schemaString("Description"),
  }, ["index_id", "title", "description"]),
  handler: async (input, context) => {
    const indexId = readNumber(input, "index_id");
    const title = readString(input, "title");
    const description = readString(input, "description");
    if (indexId === undefined) return fail("index_id is required.");
    if (!title) return fail("title is required.");
    if (!description) return fail("description is required.");

    const result = await api(context, "PUT", `/v0/indices/${indexId}`, undefined, { title, description });
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully updated index ${indexId}.`);
  },
};

const getIndexSubjectsTool: ToolDefinition = {
  name: "get_index_subjects",
  description: "List subjects in a Bangumi index.",
  inputSchema: schemaObject({
    index_id: schemaInteger("Index ID", { minimum: 1 }),
    subject_type: schemaNumber("Subject type", subjectTypeEnum),
    limit: schemaInteger("Pagination limit", { minimum: 1, maximum: 50, default: 30 }),
    offset: schemaInteger("Pagination offset", { minimum: 0, default: 0 }),
  }, ["index_id"]),
  handler: async (input, context) => {
    const indexId = readNumber(input, "index_id");
    if (indexId === undefined) return fail("index_id is required.");

    const query: Record<string, string | number | boolean | null | undefined> = {
      limit: Math.min(readNumber(input, "limit") ?? 30, 50),
      offset: readNumber(input, "offset") ?? 0,
    };
    const subjectType = readNumber(input, "subject_type");
    if (subjectType !== undefined) query.type = subjectType;

    const result = await api(context, "GET", `/v0/indices/${indexId}/subjects`, query);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success, "index subjects");
    if (!data) return fail("Unexpected response format for index subjects.");
    if (!Array.isArray(data.data)) return fail("Unexpected response format for index subjects.");
    const items = data.data.filter(isRecord).map(formatSubjectSummary);
    return ok(formatItemList(`Subjects in index ${indexId}:`, items, readNumber(data, "total")));
  },
};

const addSubjectToIndexTool: ToolDefinition = {
  name: "add_subject_to_index",
  description: "Add a subject to a Bangumi index.",
  requiresAuth: true,
  inputSchema: schemaObject({
    index_id: schemaInteger("Index ID", { minimum: 1 }),
    subject_id: schemaInteger("Subject ID", { minimum: 1 }),
    comment: schemaString("Comment"),
  }, ["index_id", "subject_id"]),
  handler: async (input, context) => {
    const indexId = readNumber(input, "index_id");
    const subjectId = readNumber(input, "subject_id");
    const comment = readString(input, "comment");
    if (indexId === undefined) return fail("index_id is required.");
    if (subjectId === undefined) return fail("subject_id is required.");

    const payload: Record<string, unknown> = { subject_id: subjectId };
    if (comment !== undefined) payload.comment = comment;

    const result = await api(context, "POST", `/v0/indices/${indexId}/subjects`, undefined, payload);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully added subject ${subjectId} to index ${indexId}.`);
  },
};

const updateIndexSubjectTool: ToolDefinition = {
  name: "update_index_subject",
  description: "Update a subject entry inside a Bangumi index.",
  requiresAuth: true,
  inputSchema: schemaObject({
    index_id: schemaInteger("Index ID", { minimum: 1 }),
    subject_id: schemaInteger("Subject ID", { minimum: 1 }),
    comment: schemaString("Comment"),
  }, ["index_id", "subject_id"]),
  handler: async (input, context) => {
    const indexId = readNumber(input, "index_id");
    const subjectId = readNumber(input, "subject_id");
    const comment = readString(input, "comment");
    if (indexId === undefined) return fail("index_id is required.");
    if (subjectId === undefined) return fail("subject_id is required.");

    if (comment === undefined) {
      return fail("Provide at least one field to update.");
    }

    const result = await api(context, "PUT", `/v0/indices/${indexId}/subjects/${subjectId}`, undefined, { comment });
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully updated subject ${subjectId} in index ${indexId}.`);
  },
};

const removeSubjectFromIndexTool: ToolDefinition = {
  name: "remove_subject_from_index",
  description: "Remove a subject from a Bangumi index.",
  requiresAuth: true,
  inputSchema: schemaObject({
    index_id: schemaInteger("Index ID", { minimum: 1 }),
    subject_id: schemaInteger("Subject ID", { minimum: 1 }),
  }, ["index_id", "subject_id"]),
  handler: async (input, context) => {
    const indexId = readNumber(input, "index_id");
    const subjectId = readNumber(input, "subject_id");
    if (indexId === undefined) return fail("index_id is required.");
    if (subjectId === undefined) return fail("subject_id is required.");

    const result = await api(context, "DELETE", `/v0/indices/${indexId}/subjects/${subjectId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Successfully removed subject ${subjectId} from index ${indexId}.`);
  },
};

const getPersonRevisionsTool: ToolDefinition = {
  name: "get_person_revisions",
  description: "Get revision history for a person.",
  inputSchema: schemaObject({
    person_id: schemaInteger("Person ID", { minimum: 1 }),
    limit: schemaInteger("Pagination limit", { minimum: 1, maximum: 50, default: 30 }),
    offset: schemaInteger("Pagination offset", { minimum: 0, default: 0 }),
  }, ["person_id"]),
  handler: async (input, context) => {
    const personId = readNumber(input, "person_id");
    if (personId === undefined) return fail("person_id is required.");

    const query = {
      person_id: personId,
      limit: Math.min(readNumber(input, "limit") ?? 30, 50),
      offset: readNumber(input, "offset") ?? 0,
    };

    const result = await api(context, "GET", "/v0/revisions/persons", query);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success, "person revisions");
    if (!data) return fail("Unexpected response format for person revisions.");
    if (!Array.isArray(data.data)) return fail("Unexpected response format for person revisions.");
    const items = data.data.filter(isRecord).map(formatRevisionSummary);
    return ok(formatItemList(`Revisions for person ${personId}:`, items, readNumber(data, "total")));
  },
};

const getPersonRevisionTool: ToolDefinition = {
  name: "get_person_revision",
  description: "Get a single person revision.",
  inputSchema: schemaObject({ revision_id: schemaInteger("Revision ID", { minimum: 1 }) }, ["revision_id"]),
  handler: async (input, context) => {
    const revisionId = readNumber(input, "revision_id");
    if (revisionId === undefined) return fail("revision_id is required.");

    const result = await api(context, "GET", `/v0/revisions/persons/${revisionId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Revision details:\n${prettyJson(success.data)}`);
  },
};

const getCharacterRevisionsTool: ToolDefinition = {
  name: "get_character_revisions",
  description: "Get revision history for a character.",
  inputSchema: schemaObject({
    character_id: schemaInteger("Character ID", { minimum: 1 }),
    limit: schemaInteger("Pagination limit", { minimum: 1, maximum: 50, default: 30 }),
    offset: schemaInteger("Pagination offset", { minimum: 0, default: 0 }),
  }, ["character_id"]),
  handler: async (input, context) => {
    const characterId = readNumber(input, "character_id");
    if (characterId === undefined) return fail("character_id is required.");

    const query = {
      character_id: characterId,
      limit: Math.min(readNumber(input, "limit") ?? 30, 50),
      offset: readNumber(input, "offset") ?? 0,
    };

    const result = await api(context, "GET", "/v0/revisions/characters", query);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success, "character revisions");
    if (!data) return fail("Unexpected response format for character revisions.");
    if (!Array.isArray(data.data)) return fail("Unexpected response format for character revisions.");
    const items = data.data.filter(isRecord).map(formatRevisionSummary);
    return ok(formatItemList(`Revisions for character ${characterId}:`, items, readNumber(data, "total")));
  },
};

const getCharacterRevisionTool: ToolDefinition = {
  name: "get_character_revision",
  description: "Get a single character revision.",
  inputSchema: schemaObject({ revision_id: schemaInteger("Revision ID", { minimum: 1 }) }, ["revision_id"]),
  handler: async (input, context) => {
    const revisionId = readNumber(input, "revision_id");
    if (revisionId === undefined) return fail("revision_id is required.");

    const result = await api(context, "GET", `/v0/revisions/characters/${revisionId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Revision details:\n${prettyJson(success.data)}`);
  },
};

const getSubjectRevisionsTool: ToolDefinition = {
  name: "get_subject_revisions",
  description: "Get revision history for a subject.",
  inputSchema: schemaObject({
    subject_id: schemaInteger("Subject ID", { minimum: 1 }),
    limit: schemaInteger("Pagination limit", { minimum: 1, maximum: 50, default: 30 }),
    offset: schemaInteger("Pagination offset", { minimum: 0, default: 0 }),
  }, ["subject_id"]),
  handler: async (input, context) => {
    const subjectId = readNumber(input, "subject_id");
    if (subjectId === undefined) return fail("subject_id is required.");

    const query = {
      subject_id: subjectId,
      limit: Math.min(readNumber(input, "limit") ?? 30, 50),
      offset: readNumber(input, "offset") ?? 0,
    };

    const result = await api(context, "GET", "/v0/revisions/subjects", query);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success, "subject revisions");
    if (!data) return fail("Unexpected response format for subject revisions.");
    if (!Array.isArray(data.data)) return fail("Unexpected response format for subject revisions.");
    const items = data.data.filter(isRecord).map(formatRevisionSummary);
    return ok(formatItemList(`Revisions for subject ${subjectId}:`, items, readNumber(data, "total")));
  },
};

const getSubjectRevisionTool: ToolDefinition = {
  name: "get_subject_revision",
  description: "Get a single subject revision.",
  inputSchema: schemaObject({ revision_id: schemaInteger("Revision ID", { minimum: 1 }) }, ["revision_id"]),
  handler: async (input, context) => {
    const revisionId = readNumber(input, "revision_id");
    if (revisionId === undefined) return fail("revision_id is required.");

    const result = await api(context, "GET", `/v0/revisions/subjects/${revisionId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Revision details:\n${prettyJson(success.data)}`);
  },
};

const getEpisodeRevisionsTool: ToolDefinition = {
  name: "get_episode_revisions",
  description: "Get revision history for an episode.",
  inputSchema: schemaObject({
    episode_id: schemaInteger("Episode ID", { minimum: 1 }),
    limit: schemaInteger("Pagination limit", { minimum: 1, maximum: 50, default: 30 }),
    offset: schemaInteger("Pagination offset", { minimum: 0, default: 0 }),
  }, ["episode_id"]),
  handler: async (input, context) => {
    const episodeId = readNumber(input, "episode_id");
    if (episodeId === undefined) return fail("episode_id is required.");

    const query = {
      episode_id: episodeId,
      limit: Math.min(readNumber(input, "limit") ?? 30, 50),
      offset: readNumber(input, "offset") ?? 0,
    };

    const result = await api(context, "GET", "/v0/revisions/episodes", query);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success, "episode revisions");
    if (!data) return fail("Unexpected response format for episode revisions.");
    if (!Array.isArray(data.data)) return fail("Unexpected response format for episode revisions.");
    const items = data.data.filter(isRecord).map(formatRevisionSummary);
    return ok(formatItemList(`Revisions for episode ${episodeId}:`, items, readNumber(data, "total")));
  },
};

const getEpisodeRevisionTool: ToolDefinition = {
  name: "get_episode_revision",
  description: "Get a single episode revision.",
  inputSchema: schemaObject({ revision_id: schemaInteger("Revision ID", { minimum: 1 }) }, ["revision_id"]),
  handler: async (input, context) => {
    const revisionId = readNumber(input, "revision_id");
    if (revisionId === undefined) return fail("revision_id is required.");

    const result = await api(context, "GET", `/v0/revisions/episodes/${revisionId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Revision details:\n${prettyJson(success.data)}`);
  },
};

const resources: ResourceDefinition[] = [
  {
    uri: "bangumi://openapi",
    name: "Bangumi OpenAPI Spec",
    description: "Bangumi API OpenAPI specification copied into the repository.",
    mimeType: "application/json",
    read: async () => prettyJson(openapiSpec),
  },
];

export const tools: ToolDefinition[] = [
  calendarTool,
  searchSubjectsTool,
  browseSubjectsTool,
  getSubjectDetailsTool,
  getSubjectImageTool,
  getSubjectPersonsTool,
  getSubjectCharactersTool,
  getSubjectRelationsTool,
  getEpisodesTool,
  getEpisodeDetailsTool,
  searchPersonsTool,
  getPersonDetailsTool,
  getPersonSubjectsTool,
  getPersonCharactersTool,
  getPersonImageTool,
  collectPersonTool,
  uncollectPersonTool,
  searchCharactersTool,
  getCharacterDetailsTool,
  getCharacterImageTool,
  getCharacterSubjectsTool,
  getCharacterPersonsTool,
  collectCharacterTool,
  uncollectCharacterTool,
  getUserInfoTool,
  getUserAvatarTool,
  getCurrentUserTool,
  getUserCollectionsTool,
  getUserSubjectCollectionTool,
  updateSubjectCollectionTool,
  getUserEpisodeCollectionTool,
  updateEpisodeCollectionTool,
  getSingleEpisodeCollectionTool,
  updateSingleEpisodeCollectionTool,
  getUserCharacterCollectionsTool,
  getUserCharacterCollectionTool,
  getUserPersonCollectionsTool,
  getUserPersonCollectionTool,
  createIndexTool,
  getIndexTool,
  updateIndexTool,
  getIndexSubjectsTool,
  addSubjectToIndexTool,
  updateIndexSubjectTool,
  removeSubjectFromIndexTool,
  collectIndexTool,
  uncollectIndexTool,
  getPersonRevisionsTool,
  getPersonRevisionTool,
  getCharacterRevisionsTool,
  getCharacterRevisionTool,
  getSubjectRevisionsTool,
  getSubjectRevisionTool,
  getEpisodeRevisionsTool,
  getEpisodeRevisionTool,
];

export { resources };
