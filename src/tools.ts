import openapiSpec from "../docs/bangumi-tv-api.json";
import type { RuntimeConfig } from "./config";
import { requestBangumi, formatBangumiFailure, type BangumiResult, type BangumiSuccess } from "./lib/bangumi";
import {
  formatCharacterSummary,
  formatCollectionStatus,
  formatEpisodeCollectionStatus,
  formatEpisodeSummary,
  formatItemList,
  formatPersonSummary,
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

export interface ToolEntry {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ResourceEntry {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

const SUBJECT_TYPES: Record<number, string> = {
  1: "Book",
  2: "Anime",
  3: "Music",
  4: "Game",
  6: "Real",
};

const PERSON_CAREERS = ["producer", "mangaka", "artist", "seiyu", "writer", "illustrator", "actor"] as const;
const SEARCH_SCOPES = ["all", "subject", "person", "character"] as const;
const SUBJECT_SORTS = ["match", "heat", "rank", "score"] as const;
const IMAGE_TYPES = ["small", "grid", "large", "medium", "common"] as const;
const AVATAR_TYPES = ["small", "large", "medium"] as const;
const COLLECTION_TYPES = [1, 2, 3, 4, 5] as const;
const EPISODE_COLLECTION_TYPES = [1, 2, 3] as const;
const EPISODE_TYPES = [0, 1, 2, 3, 4, 5, 6] as const;
const UPDATE_TARGET_TYPES = ["subject", "person", "character", "episode", "episode_batch"] as const;
const SUBJECT_STATUS_VALUES = ["wish", "watching", "done", "on_hold", "dropped"] as const;
const BROWSE_SORTS = ["date", "rank"] as const;
const COLLECTION_TARGETS = ["person", "character"] as const;
const IMAGE_TARGETS = ["subject", "person", "character", "user"] as const;
const INDEX_ACTIONS = [
  "create",
  "get",
  "update",
  "list_subjects",
  "add_subject",
  "update_subject",
  "remove_subject",
  "collect",
  "uncollect",
] as const;
const UPDATE_COLLECTION_SCOPES = ["subject", "episode", "character", "person"] as const;
const UPDATE_COLLECTION_ACTIONS = ["update", "collect", "uncollect"] as const;

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

function schemaObject(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
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

function readStringArray(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key];
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return strings.length === value.length ? strings : undefined;
}

function readObject(input: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = input[key];
  return isRecord(value) ? value : undefined;
}

function statusToCollectionType(status: string): number | undefined {
  switch (status) {
    case "wish":
      return 1;
    case "watching":
      return 3;
    case "done":
      return 2;
    case "on_hold":
      return 4;
    case "dropped":
      return 5;
    default:
      return undefined;
  }
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

function getDataObject(response: BangumiSuccess): Record<string, unknown> | null {
  return isRecord(response.data) ? response.data : null;
}

function getDataArray(response: BangumiSuccess): unknown[] | null {
  return Array.isArray(response.data) ? response.data : null;
}

function formatCountMap(title: string, counts: Map<string, number>): string {
  const lines = [title];
  if (counts.size === 0) {
    lines.push("- None");
    return lines.join("\n");
  }

  for (const [label, count] of counts.entries()) {
    lines.push(`- ${label}: ${count}`);
  }

  return lines.join("\n");
}

function subjectTypeLabel(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unknown";
  }

  return SUBJECT_TYPES[value] ?? `Unknown (${value})`;
}

function addCount(map: Map<string, number>, label: string): void {
  map.set(label, (map.get(label) ?? 0) + 1);
}

function formatSubjectSection(title: string, subjects: Record<string, unknown>[]): string {
  return formatItemList(title, subjects.map(formatSubjectSummary));
}

function formatPersonSection(title: string, persons: Record<string, unknown>[]): string {
  return formatItemList(title, persons.map(formatPersonSummary));
}

function formatCharacterSection(title: string, characters: Record<string, unknown>[]): string {
  return formatItemList(title, characters.map(formatCharacterSummary));
}

function buildEntityResponse(
  headline: string,
  summary: string,
  details: unknown,
  sections: string[],
): ToolResponse {
  const lines = [`${headline}: ${summary}`, `Details:\n${prettyJson(details)}`];
  for (const section of sections) {
    if (section.length > 0) {
      lines.push(section);
    }
  }
  return ok(lines.join("\n\n"));
}

type SectionPayload<T> = { data: T } | { _error: string };

function sectionData<T>(data: T): SectionPayload<T> {
  return { data };
}

function sectionError(message: string): SectionPayload<never> {
  return { _error: message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function captureSection<T>(
  task: Promise<BangumiResult>,
  parse: (success: BangumiSuccess) => T | undefined,
  fallbackMessage: string,
): Promise<SectionPayload<T>> {
  try {
    const result = await task;
    if (!result.ok) {
      return sectionError(formatBangumiFailure(result));
    }

    const parsed = parse(result);
    if (parsed === undefined) {
      return sectionError(fallbackMessage);
    }

    return sectionData(parsed);
  } catch (error) {
    return sectionError(errorMessage(error));
  }
}

function getRequestedIncludes(input: Record<string, unknown>): string[] {
  const includes = readStringArray(input, "include");
  if (!includes) {
    return [];
  }

  const allowed = new Set(["persons", "characters", "relations", "episodes"]);
  const invalid = includes.find((item) => !allowed.has(item));
  if (invalid) {
    throw new Error(`invalid_argument: unsupported include "${invalid}".`);
  }

  return [...new Set(includes)];
}

function validateOnlyAllowedFields(
  input: Record<string, unknown>,
  allowed: string[],
  contextLabel: string,
): string | null {
  for (const key of Object.keys(input)) {
    if (key === "target_type" || allowed.includes(key)) {
      continue;
    }

    return `invalid_argument: ${contextLabel} does not accept "${key}".`;
  }

  return null;
}

function toSearchSection(response: ToolResponse): { data: string } | { _error: string } {
  return response.ok ? { data: response.text } : { _error: response.text };
}

async function searchSubjects(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  const keyword = readString(input, "keyword");
  if (!keyword) {
    return fail("keyword is required.");
  }

  const limit = Math.min(readNumber(input, "limit") ?? 10, 20);
  const offset = readNumber(input, "offset") ?? 0;
  const subjectType = readNumber(input, "subject_type");
  const sort = readString(input, "subject_sort") ?? "match";
  const nsfwFilter = readBoolean(input, "nsfw_filter");

  const payload: Record<string, unknown> = { keyword, sort, filter: {} };
  if (subjectType !== undefined) {
    (payload.filter as Record<string, unknown>).type = [subjectType];
  }
  if (nsfwFilter !== undefined) {
    (payload.filter as Record<string, unknown>).nsfw = nsfwFilter;
  }

  const result = await api(context, "POST", "/v0/search/subjects", { limit, offset }, payload);
  const success = ensureBangumiSuccess(result);
  if (!success) {
    return fail(formatBangumiFailure(result));
  }

  const data = getDataObject(success);
  if (!data || !Array.isArray(data.data)) {
    return fail("Unexpected response format for search subjects.");
  }

  const items = data.data.filter(isRecord).map(formatSubjectSummary);
  return ok(formatItemList(`Subjects for "${keyword}":`, items, readNumber(data, "total")));
}

async function searchPersons(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  const keyword = readString(input, "keyword");
  if (!keyword) {
    return fail("keyword is required.");
  }

  const limit = Math.min(readNumber(input, "limit") ?? 10, 20);
  const offset = readNumber(input, "offset") ?? 0;
  const careerFilter = readStringArray(input, "career_filter");
  const nsfwFilter = readBoolean(input, "nsfw_filter");

  const payload: Record<string, unknown> = { keyword, filter: {} };
  if (careerFilter && careerFilter.length > 0) {
    (payload.filter as Record<string, unknown>).career = careerFilter;
  }
  if (nsfwFilter !== undefined) {
    (payload.filter as Record<string, unknown>).nsfw = nsfwFilter;
  }

  const result = await api(context, "POST", "/v0/search/persons", { limit, offset }, payload);
  const success = ensureBangumiSuccess(result);
  if (!success) {
    return fail(formatBangumiFailure(result));
  }

  const data = getDataObject(success);
  if (!data || !Array.isArray(data.data)) {
    return fail("Unexpected response format for search persons.");
  }

  const items = data.data.filter(isRecord).map(formatPersonSummary);
  return ok(formatItemList(`Persons for "${keyword}":`, items, readNumber(data, "total")));
}

async function searchCharacters(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  const keyword = readString(input, "keyword");
  if (!keyword) {
    return fail("keyword is required.");
  }

  const limit = Math.min(readNumber(input, "limit") ?? 10, 20);
  const offset = readNumber(input, "offset") ?? 0;
  const nsfwFilter = readBoolean(input, "nsfw_filter");

  const payload: Record<string, unknown> = { keyword, filter: {} };
  if (nsfwFilter !== undefined) {
    (payload.filter as Record<string, unknown>).nsfw = nsfwFilter;
  }

  const result = await api(context, "POST", "/v0/search/characters", { limit, offset }, payload);
  const success = ensureBangumiSuccess(result);
  if (!success) {
    return fail(formatBangumiFailure(result));
  }

  const data = getDataObject(success);
  if (!data || !Array.isArray(data.data)) {
    return fail("Unexpected response format for search characters.");
  }

  const items = data.data.filter(isRecord).map(formatCharacterSummary);
  return ok(formatItemList(`Characters for "${keyword}":`, items, readNumber(data, "total")));
}

async function apiCalendar(context: ToolContext): Promise<ToolResponse> {
  const result = await api(context, "GET", "/calendar");
  const success = ensureBangumiSuccess(result);
  if (!success) {
    return fail(formatBangumiFailure(result));
  }

  const days = getDataArray(success);
  if (!days) {
    return fail("Unexpected response format for calendar.");
  }

  const sections = days.map((day) => {
    if (!isRecord(day)) {
      return "Unexpected calendar item format.";
    }

    const weekday = isRecord(day.weekday) ? day.weekday : {};
    const weekdayName =
      readString(weekday, "cn") ?? readString(weekday, "ja") ?? readString(weekday, "en") ?? "Unknown day";
    if (!Array.isArray(day.items)) {
      return "Unexpected calendar item format.";
    }

    const items = day.items.filter(isRecord).map(formatSubjectSummary);
    return formatItemList(`--- ${weekdayName} ---`, items);
  });

  return ok(formatItemList("Daily Broadcast Schedule:", sections));
}

async function getSubject(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  const subjectId = readNumber(input, "subject_id");
  if (subjectId === undefined) {
    return fail("subject_id is required.");
  }

  let requestedIncludes: string[];
  try {
    requestedIncludes = getRequestedIncludes(input);
  } catch (error) {
    return fail(errorMessage(error));
  }

  const includeSet = new Set(requestedIncludes);
  const episodeLimit = Math.min(readNumber(input, "episode_limit") ?? 100, 200);
  const episodeOffset = readNumber(input, "episode_offset") ?? 0;
  const episodeType = readNumber(input, "episode_type");

  const subjectTask = captureSection(
    api(context, "GET", `/v0/subjects/${subjectId}`),
    (success) => {
      const subject = getDataObject(success);
      if (!subject) {
        return undefined;
      }
      return {
        summary: formatSubjectSummary(subject),
        data: subject,
      };
    },
    "Unexpected response format for subject details.",
  );

  const personsTask = includeSet.has("persons")
    ? captureSection(
        api(context, "GET", `/v0/subjects/${subjectId}/persons`),
        (success) => {
          const persons = getDataArray(success);
          if (!persons) {
            return undefined;
          }
          return {
            items: persons.filter(isRecord).map(formatPersonSummary),
          };
        },
        "Unexpected response format for subject persons.",
      )
    : null;

  const charactersTask = includeSet.has("characters")
    ? captureSection(
        api(context, "GET", `/v0/subjects/${subjectId}/characters`),
        (success) => {
          const characters = getDataArray(success);
          if (!characters) {
            return undefined;
          }
          return {
            items: characters.filter(isRecord).map(formatCharacterSummary),
          };
        },
        "Unexpected response format for subject characters.",
      )
    : null;

  const relationsTask = includeSet.has("relations")
    ? captureSection(
        api(context, "GET", `/v0/subjects/${subjectId}/subjects`),
        (success) => {
          const relations = getDataArray(success);
          if (!relations) {
            return undefined;
          }
          return {
            items: relations.filter(isRecord).map(formatSubjectSummary),
          };
        },
        "Unexpected response format for subject relations.",
      )
    : null;

  const episodesTask = includeSet.has("episodes")
    ? captureSection(
        api(context, "GET", "/v0/episodes", {
          subject_id: subjectId,
          limit: episodeLimit,
          offset: episodeOffset,
          ...(episodeType !== undefined ? { type: episodeType } : {}),
        }),
        (success) => {
          const episodes = getDataObject(success);
          if (!episodes || !Array.isArray(episodes.data)) {
            return undefined;
          }
          return {
            total: readNumber(episodes, "total"),
            items: episodes.data.filter(isRecord).map(formatEpisodeSummary),
          };
        },
        "Unexpected response format for subject episodes.",
      )
    : null;

  const [subject, persons, characters, relations, episodes] = await Promise.all([
    subjectTask,
    personsTask ?? Promise.resolve(undefined),
    charactersTask ?? Promise.resolve(undefined),
    relationsTask ?? Promise.resolve(undefined),
    episodesTask ?? Promise.resolve(undefined),
  ]);

  const response: Record<string, unknown> = {
    subject,
  };

  const includes: Record<string, unknown> = {};
  if (persons) {
    includes.persons = persons;
  }
  if (characters) {
    includes.characters = characters;
  }
  if (relations) {
    includes.relations = relations;
  }
  if (episodes) {
    includes.episodes = episodes;
  }

  if (Object.keys(includes).length > 0) {
    response.includes = includes;
  }

  return ok(prettyJson(response));
}

async function getUser(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  const username = readString(input, "username");
  const collectionLimit = Math.min(readNumber(input, "collection_limit") ?? 50, 50);
  const collectionOffset = readNumber(input, "collection_offset") ?? 0;
  const subjectType = readNumber(input, "subject_type");
  const collectionType = readNumber(input, "collection_type");
  const subjectId = readNumber(input, "subject_id");

  if (!username && !context.authToken) {
    return fail("username is required when no Authorization header is present.");
  }

  const profile = await captureSection(
    api(context, "GET", username ? `/v0/users/${username}` : "/v0/me"),
    (success) => {
      const profile = getDataObject(success);
      if (!profile) {
        return undefined;
      }
      return {
        summary: readString(profile, "nickname") ?? readString(profile, "username") ?? username ?? "current user",
        data: profile,
      };
    },
    "Unexpected response format for user profile.",
  );

  const collectionQuery: Record<string, string | number | boolean | null | undefined> = { limit: collectionLimit, offset: collectionOffset };
  if (subjectType !== undefined) {
    collectionQuery.subject_type = subjectType;
  }
  if (collectionType !== undefined) {
    collectionQuery.type = collectionType;
  }

  if (username) {
    if (subjectId !== undefined) {
      const collections = await captureSection(
        api(context, "GET", `/v0/users/${username}/collections/${subjectId}`),
        (success) => getDataObject(success) ?? undefined,
        "Unexpected response format for subject collection.",
      );
      return ok(prettyJson({ user: profile, collections }));
    }

    const collections = await captureSection(
      api(context, "GET", `/v0/users/${username}/collections`, collectionQuery),
      (success) => {
        const collections = getDataObject(success);
        if (!collections || !Array.isArray(collections.data)) {
          return undefined;
        }

        return {
          total: readNumber(collections, "total"),
          items: collections.data.filter(isRecord).map((item) => {
            const subject = isRecord(item.subject) ? item.subject : {};
            return {
              subject: {
                summary: formatSubjectSummary(subject),
                data: subject,
              },
              status: formatCollectionStatus(item.type),
            };
          }),
        };
      },
      "Unexpected response format for user collections.",
    );

    return ok(prettyJson({ user: profile, collections }));
  }

  if ("_error" in profile) {
    return ok(prettyJson({ user: profile }));
  }

  const profileData = profile.data;
  const resolvedUsername = isRecord(profileData.data) ? readString(profileData.data, "username") : undefined;
  if (!resolvedUsername) {
    return ok(prettyJson({ user: profile, collections: { _error: "Unable to resolve current username." } }));
  }

  if (subjectId !== undefined) {
    const collections = await captureSection(
      api(context, "GET", `/v0/users/${resolvedUsername}/collections/${subjectId}`),
      (success) => getDataObject(success) ?? undefined,
      "Unexpected response format for subject collection.",
    );
    return ok(prettyJson({ user: profile, collections }));
  }

  const collections = await captureSection(
    api(context, "GET", `/v0/users/${resolvedUsername}/collections`, collectionQuery),
    (success) => {
      const collections = getDataObject(success);
      if (!collections || !Array.isArray(collections.data)) {
        return undefined;
      }

      return {
        total: readNumber(collections, "total"),
        items: collections.data.filter(isRecord).map((item) => {
          const subject = isRecord(item.subject) ? item.subject : {};
          return {
            subject: {
              summary: formatSubjectSummary(subject),
              data: subject,
            },
            status: formatCollectionStatus(item.type),
          };
        }),
      };
    },
    "Unexpected response format for user collections.",
  );

  return ok(
    prettyJson({
      user: profile,
      collections,
    }),
  );
}

async function updateCollection(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  const targetType = readString(input, "target_type");
  if (!targetType || !UPDATE_TARGET_TYPES.includes(targetType as (typeof UPDATE_TARGET_TYPES)[number])) {
    return fail(`invalid_argument: target_type must be one of: ${UPDATE_TARGET_TYPES.join(", ")}.`);
  }

  if (targetType === "subject") {
    const fieldError = validateOnlyAllowedFields(
      input,
      ["target_type", "subject_id", "subject_status", "progress", "comment", "rating"],
      "subject target",
    );
    if (fieldError) {
      return fail(fieldError);
    }
  } else if (targetType === "person") {
    const fieldError = validateOnlyAllowedFields(input, ["target_type", "person_id", "favorite"], "person target");
    if (fieldError) {
      return fail(fieldError);
    }
  } else if (targetType === "character") {
    const fieldError = validateOnlyAllowedFields(input, ["target_type", "character_id", "favorite"], "character target");
    if (fieldError) {
      return fail(fieldError);
    }
  }

  if (targetType === "subject") {
    const subjectId = readNumber(input, "subject_id");
    if (subjectId === undefined) {
      return fail("invalid_argument: subject_id is required for target_type=subject.");
    }

    const status = readString(input, "subject_status");
    const progress = readObject(input, "progress");
    const rating = readNumber(input, "rating");
    const comment = readString(input, "comment");

    if (!status && !progress && rating === undefined && comment === undefined) {
      return fail("invalid_argument: target_type=subject requires subject_status, progress, rating, or comment.");
    }

    const body: Record<string, unknown> = {};
    if (status !== undefined) {
      const collectionType = statusToCollectionType(status);
      if (collectionType === undefined) {
        return fail(`invalid_argument: unsupported subject_status "${status}".`);
      }
      body.type = collectionType;
    }

    if (progress !== undefined) {
      const progressError = validateOnlyAllowedFields(progress, ["episodes_watched", "volumes_read"], "progress");
      if (progressError) {
        return fail(progressError);
      }
      const episodesWatched = readNumber(progress, "episodes_watched");
      const volumesRead = readNumber(progress, "volumes_read");
      if (episodesWatched !== undefined) {
        body.ep_status = episodesWatched;
      }
      if (volumesRead !== undefined) {
        body.vol_status = volumesRead;
      }
      if (episodesWatched === undefined && volumesRead === undefined) {
        return fail("invalid_argument: progress must include episodes_watched or volumes_read.");
      }
    }

    if (rating !== undefined) {
      if (rating < 0 || rating > 10) {
        return fail("invalid_argument: rating must be between 0 and 10.");
      }
      body.rate = rating;
    }
    if (comment !== undefined) {
      body.comment = comment;
    }

    const result = await api(context, "POST", `/v0/users/-/collections/${subjectId}`, undefined, body);
    const success = ensureBangumiSuccess(result);
    if (!success) {
      return fail(formatBangumiFailure(result));
    }

    return ok(`Updated subject collection ${subjectId}.`);
  }

  if (targetType === "episode_batch") {
    const fieldError = validateOnlyAllowedFields(
      input,
      ["target_type", "subject_id", "episode_ids", "episode_status"],
      "episode_batch target",
    );
    if (fieldError) return fail(fieldError);

    const subjectId = readNumber(input, "subject_id");
    if (subjectId === undefined) return fail("invalid_argument: subject_id is required for target_type=episode_batch.");
    const episodeIds = readNumberArray(input, "episode_ids");
    if (!episodeIds || episodeIds.length === 0) return fail("invalid_argument: episode_ids is required for target_type=episode_batch.");
    const status = readNumber(input, "episode_status");
    if (status === undefined || !EPISODE_COLLECTION_TYPES.includes(status as typeof EPISODE_COLLECTION_TYPES[number])) {
      return fail(`invalid_argument: episode_status must be one of: ${EPISODE_COLLECTION_TYPES.join(", ")}.`);
    }

    const result = await api(context, "PATCH", `/v0/users/-/collections/${subjectId}/episodes`, undefined, { episode_id: episodeIds, type: status });
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Updated collection for ${episodeIds.length} episodes in subject ${subjectId}.`);
  }

  if (targetType === "episode") {
    const fieldError = validateOnlyAllowedFields(
      input,
      ["target_type", "episode_id", "episode_status"],
      "episode target",
    );
    if (fieldError) return fail(fieldError);

    const episodeId = readNumber(input, "episode_id");
    if (episodeId === undefined) return fail("invalid_argument: episode_id is required for target_type=episode.");
    const status = readNumber(input, "episode_status");
    if (status === undefined || !EPISODE_COLLECTION_TYPES.includes(status as typeof EPISODE_COLLECTION_TYPES[number])) {
      return fail(`invalid_argument: episode_status must be one of: ${EPISODE_COLLECTION_TYPES.join(", ")}.`);
    }

    const result = await api(context, "PUT", `/v0/users/-/collections/-/episodes/${episodeId}`, undefined, { type: status });
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(`Updated collection for episode ${episodeId}.`);
  }

  const favorite = readBoolean(input, "favorite");
  if (favorite === undefined) {
    return fail(`invalid_argument: favorite is required for target_type=${targetType}.`);
  }

  if (readString(input, "subject_status") !== undefined || readObject(input, "progress") !== undefined || readString(input, "comment") !== undefined || readNumber(input, "rating") !== undefined) {
    return fail(`invalid_argument: target_type=${targetType} cannot use subject_status, progress, comment, or rating.`);
  }

  const targetIdKey = targetType === "character" ? "character_id" : "person_id";
  const targetId = readNumber(input, targetIdKey);
  if (targetId === undefined) {
    return fail(`invalid_argument: ${targetIdKey} is required for target_type=${targetType}.`);
  }

  const pathBase = targetType === "character" ? `/v0/characters/${targetId}/collect` : `/v0/persons/${targetId}/collect`;
  const method = favorite ? "POST" : "DELETE";
  const result = await api(context, method, pathBase);
  const success = ensureBangumiSuccess(result);
  if (!success) {
    return fail(formatBangumiFailure(result));
  }

  return ok(`${favorite ? "Collected" : "Uncollected"} ${targetType} ${targetId}.`);
}

async function getPerson(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  const personId = readNumber(input, "person_id");
  if (personId === undefined) {
    return fail("person_id is required.");
  }

  const [person, subjects, characters] = await Promise.all([
    captureSection(
      api(context, "GET", `/v0/persons/${personId}`),
      (success) => {
        const person = getDataObject(success);
        if (!person) {
          return undefined;
        }
        return {
          summary: formatPersonSummary(person),
          data: person,
        };
      },
      "Unexpected response format for person details.",
    ),
    captureSection(
      api(context, "GET", `/v0/persons/${personId}/subjects`),
      (success) => {
        const subjects = getDataArray(success);
        if (!subjects) {
          return undefined;
        }
        return {
          items: subjects.filter(isRecord).map(formatSubjectSummary),
        };
      },
      "Unexpected response format for person subjects.",
    ),
    captureSection(
      api(context, "GET", `/v0/persons/${personId}/characters`),
      (success) => {
        const characters = getDataArray(success);
        if (!characters) {
          return undefined;
        }
        return {
          items: characters.filter(isRecord).map(formatCharacterSummary),
        };
      },
      "Unexpected response format for person characters.",
    ),
  ]);

  return ok(prettyJson({ person, subjects, characters }));
}

async function getCharacter(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  const characterId = readNumber(input, "character_id");
  if (characterId === undefined) {
    return fail("character_id is required.");
  }

  const [character, subjects, persons] = await Promise.all([
    captureSection(
      api(context, "GET", `/v0/characters/${characterId}`),
      (success) => {
        const character = getDataObject(success);
        if (!character) {
          return undefined;
        }
        return {
          summary: formatCharacterSummary(character),
          data: character,
        };
      },
      "Unexpected response format for character details.",
    ),
    captureSection(
      api(context, "GET", `/v0/characters/${characterId}/subjects`),
      (success) => {
        const subjects = getDataArray(success);
        if (!subjects) {
          return undefined;
        }
        return {
          items: subjects.filter(isRecord).map(formatSubjectSummary),
        };
      },
      "Unexpected response format for character subjects.",
    ),
    captureSection(
      api(context, "GET", `/v0/characters/${characterId}/persons`),
      (success) => {
        const persons = getDataArray(success);
        if (!persons) {
          return undefined;
        }
        return {
          items: persons.filter(isRecord).map(formatPersonSummary),
        };
      },
      "Unexpected response format for character persons.",
    ),
  ]);

  return ok(prettyJson({ character, subjects, persons }));
}

async function manageIndex(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  if (!context.config.enableIndexTools) {
    return fail("manage_index is disabled. Set BANGUMI_ENABLE_INDEX_TOOLS=true to enable it.");
  }

  const action = readString(input, "action");
  if (!action || !INDEX_ACTIONS.includes(action as (typeof INDEX_ACTIONS)[number])) {
    return fail(`action must be one of: ${INDEX_ACTIONS.join(", ")}.`);
  }

  switch (action) {
    case "create": {
      const title = readString(input, "title");
      const description = readString(input, "description");
      if (!title) {
        return fail("title is required.");
      }
      if (!description) {
        return fail("description is required.");
      }

      const result = await api(context, "POST", "/v0/indices", undefined, { title, description });
      const success = ensureBangumiSuccess(result);
      if (!success) {
        return fail(formatBangumiFailure(result));
      }
      return ok(`Successfully created index:\n${prettyJson(success.data)}`);
    }
    case "get": {
      const indexId = readNumber(input, "index_id");
      if (indexId === undefined) {
        return fail("index_id is required.");
      }

      const result = await api(context, "GET", `/v0/indices/${indexId}`);
      const success = ensureBangumiSuccess(result);
      if (!success) {
        return fail(formatBangumiFailure(result));
      }
      return ok(`Index details:\n${prettyJson(success.data)}`);
    }
    case "update": {
      const indexId = readNumber(input, "index_id");
      const title = readString(input, "title");
      const description = readString(input, "description");
      if (indexId === undefined) {
        return fail("index_id is required.");
      }
      if (!title) {
        return fail("title is required.");
      }
      if (!description) {
        return fail("description is required.");
      }

      const result = await api(context, "PUT", `/v0/indices/${indexId}`, undefined, { title, description });
      const success = ensureBangumiSuccess(result);
      if (!success) {
        return fail(formatBangumiFailure(result));
      }
      return ok(`Successfully updated index ${indexId}.`);
    }
    case "list_subjects": {
      const indexId = readNumber(input, "index_id");
      if (indexId === undefined) {
        return fail("index_id is required.");
      }

      const limit = Math.min(readNumber(input, "limit") ?? 30, 50);
      const offset = readNumber(input, "offset") ?? 0;
      const subjectType = readNumber(input, "subject_type");
      const query: Record<string, string | number | boolean | null | undefined> = { limit, offset };
      if (subjectType !== undefined) {
        query.type = subjectType;
      }

      const result = await api(context, "GET", `/v0/indices/${indexId}/subjects`, query);
      const success = ensureBangumiSuccess(result);
      if (!success) {
        return fail(formatBangumiFailure(result));
      }

      const data = getDataObject(success);
      if (!data || !Array.isArray(data.data)) {
        return fail("Unexpected response format for index subjects.");
      }

      const items = data.data.filter(isRecord).map(formatSubjectSummary);
      return ok(formatItemList(`Subjects in index ${indexId}:`, items, readNumber(data, "total")));
    }
    case "add_subject": {
      const indexId = readNumber(input, "index_id");
      const subjectId = readNumber(input, "subject_id");
      const comment = readString(input, "comment");
      if (indexId === undefined) {
        return fail("index_id is required.");
      }
      if (subjectId === undefined) {
        return fail("subject_id is required.");
      }

      const body: Record<string, unknown> = { subject_id: subjectId };
      if (comment !== undefined) {
        body.comment = comment;
      }

      const result = await api(context, "POST", `/v0/indices/${indexId}/subjects`, undefined, body);
      const success = ensureBangumiSuccess(result);
      if (!success) {
        return fail(formatBangumiFailure(result));
      }
      return ok(`Successfully added subject ${subjectId} to index ${indexId}.`);
    }
    case "update_subject": {
      const indexId = readNumber(input, "index_id");
      const subjectId = readNumber(input, "subject_id");
      const comment = readString(input, "comment");
      if (indexId === undefined) {
        return fail("index_id is required.");
      }
      if (subjectId === undefined) {
        return fail("subject_id is required.");
      }
      if (comment === undefined) {
        return fail("comment is required.");
      }

      const result = await api(context, "PUT", `/v0/indices/${indexId}/subjects/${subjectId}`, undefined, {
        comment,
      });
      const success = ensureBangumiSuccess(result);
      if (!success) {
        return fail(formatBangumiFailure(result));
      }
      return ok(`Successfully updated subject ${subjectId} in index ${indexId}.`);
    }
    case "remove_subject": {
      const indexId = readNumber(input, "index_id");
      const subjectId = readNumber(input, "subject_id");
      if (indexId === undefined) {
        return fail("index_id is required.");
      }
      if (subjectId === undefined) {
        return fail("subject_id is required.");
      }

      const result = await api(context, "DELETE", `/v0/indices/${indexId}/subjects/${subjectId}`);
      const success = ensureBangumiSuccess(result);
      if (!success) {
        return fail(formatBangumiFailure(result));
      }
      return ok(`Successfully removed subject ${subjectId} from index ${indexId}.`);
    }
    case "collect": {
      const indexId = readNumber(input, "index_id");
      if (indexId === undefined) {
        return fail("index_id is required.");
      }

      const result = await api(context, "POST", `/v0/indices/${indexId}/collect`);
      const success = ensureBangumiSuccess(result);
      if (!success) {
        return fail(formatBangumiFailure(result));
      }
      return ok(`Successfully collected index ${indexId}.`);
    }
    case "uncollect": {
      const indexId = readNumber(input, "index_id");
      if (indexId === undefined) {
        return fail("index_id is required.");
      }

      const result = await api(context, "DELETE", `/v0/indices/${indexId}/collect`);
      const success = ensureBangumiSuccess(result);
      if (!success) {
        return fail(formatBangumiFailure(result));
      }
      return ok(`Successfully uncollected index ${indexId}.`);
    }
    default:
      return fail(`Unsupported action: ${action}`);
  }
}

async function browseSubjects(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  const subjectType = readNumber(input, "subject_type");
  if (subjectType === undefined) {
    return fail("subject_type is required.");
  }

  const limit = Math.min(readNumber(input, "limit") ?? 30, 50);
  const offset = readNumber(input, "offset") ?? 0;
  const cat = readNumber(input, "cat");
  const series = readBoolean(input, "series");
  const platform = readString(input, "platform");
  const sort = readString(input, "sort") ?? "date";
  const year = readNumber(input, "year");
  const month = readNumber(input, "month");

  const query: Record<string, string | number | boolean | null | undefined> = {
    type: subjectType,
    limit,
    offset,
    sort,
  };
  if (cat !== undefined) query.cat = cat;
  if (series !== undefined) query.series = series;
  if (platform !== undefined) query.platform = platform;
  if (year !== undefined) query.year = year;
  if (month !== undefined) query.month = month;

  const result = await api(context, "GET", "/v0/subjects", query);
  const success = ensureBangumiSuccess(result);
  if (!success) {
    return fail(formatBangumiFailure(result));
  }

  const data = getDataObject(success);
  if (!data || !Array.isArray(data.data)) {
    return fail("Unexpected response format for browse subjects.");
  }

  const items = data.data.filter(isRecord).map(formatSubjectSummary);
  return ok(formatItemList(`Browse subjects (type ${subjectType}):`, items, readNumber(data, "total")));
}

async function getCollections(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  const targetType = readString(input, "target_type");
  if (!targetType || !COLLECTION_TARGETS.includes(targetType as (typeof COLLECTION_TARGETS)[number])) {
    return fail(`invalid_argument: target_type must be one of: ${COLLECTION_TARGETS.join(", ")}.`);
  }

  const username = readString(input, "username");
  if (!username) {
    return fail("username is required.");
  }

  if (targetType === "person") {
    const personId = readNumber(input, "person_id");
    if (personId !== undefined) {
      const result = await api(context, "GET", `/v0/users/${username}/collections/-/persons/${personId}`);
      const success = ensureBangumiSuccess(result);
      if (!success) return fail(formatBangumiFailure(result));
      return ok(prettyJson(getDataObject(success)));
    }

    const limit = Math.min(readNumber(input, "limit") ?? 30, 50);
    const offset = readNumber(input, "offset") ?? 0;
    const result = await api(context, "GET", `/v0/users/${username}/collections/-/persons`, { limit, offset });
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success);
    if (!data || !Array.isArray(data.data)) return fail("Unexpected response format for person collections.");
    const items = data.data.filter(isRecord).map((item) => `ID: ${item.id ?? "?"} | Name: ${item.name ?? "Unknown"}`);
    return ok(formatItemList(`Person collections for ${username}:`, items, readNumber(data, "total")));
  }

  // targetType === "character"
  const characterId = readNumber(input, "character_id");
  if (characterId !== undefined) {
    const result = await api(context, "GET", `/v0/users/${username}/collections/-/characters/${characterId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    return ok(prettyJson(getDataObject(success)));
  }

  const limit = Math.min(readNumber(input, "limit") ?? 30, 50);
  const offset = readNumber(input, "offset") ?? 0;
  const result = await api(context, "GET", `/v0/users/${username}/collections/-/characters`, { limit, offset });
  const success = ensureBangumiSuccess(result);
  if (!success) return fail(formatBangumiFailure(result));

  const data = getDataObject(success);
  if (!data || !Array.isArray(data.data)) return fail("Unexpected response format for character collections.");
  const items = data.data.filter(isRecord).map((item) => `ID: ${item.id ?? "?"} | Name: ${item.name ?? "Unknown"}`);
  return ok(formatItemList(`Character collections for ${username}:`, items, readNumber(data, "total")));
}

async function getEpisode(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  const episodeId = readNumber(input, "episode_id");
  const subjectId = readNumber(input, "subject_id");
  const collection = readBoolean(input, "collection") ?? false;

  if (episodeId !== undefined) {
    if (collection) {
      const result = await api(context, "GET", `/v0/users/-/collections/-/episodes/${episodeId}`);
      const success = ensureBangumiSuccess(result);
      if (!success) return fail(formatBangumiFailure(result));
      const data = getDataObject(success);
      if (!data) return fail("Unexpected response format for episode collection.");
      const status = formatEpisodeCollectionStatus(data.type);
      const episode = isRecord(data.episode) ? data.episode : {};
      const name = readString(episode, "name") ?? readString(episode, "name_cn") ?? `Episode ${episodeId}`;
      return ok(`Episode ${episodeId} collection:\n  Status: ${status}\n  Episode: ${name}`);
    }

    const result = await api(context, "GET", `/v0/episodes/${episodeId}`);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));
    const data = getDataObject(success);
    if (!data) return fail("Unexpected response format for episode details.");
    return ok(formatEpisodeSummary(data));
  }

  if (subjectId !== undefined && collection) {
    const limit = Math.min(readNumber(input, "limit") ?? 100, 200);
    const offset = readNumber(input, "offset") ?? 0;
    const episodeType = readNumber(input, "episode_type");

    const query: Record<string, string | number | boolean | null | undefined> = { limit, offset };
    if (episodeType !== undefined) query.episode_type = episodeType;

    const result = await api(context, "GET", `/v0/users/-/collections/${subjectId}/episodes`, query);
    const success = ensureBangumiSuccess(result);
    if (!success) return fail(formatBangumiFailure(result));

    const data = getDataObject(success);
    if (!data || !Array.isArray(data.data)) return fail("Unexpected response format for episode collections.");
    const items = data.data.filter(isRecord).map((item) => {
      const ep = isRecord(item.episode) ? item.episode : {};
      return `${formatEpisodeSummary(ep)} | Collection: ${formatEpisodeCollectionStatus(item.type)}`;
    });
    return ok(formatItemList(`Episode collections for subject ${subjectId}:`, items, readNumber(data, "total")));
  }

  return fail("Provide episode_id for details/single collection, or subject_id + collection=true for the collection list.");
}

async function getImage(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  const targetType = readString(input, "target_type");
  if (!targetType || !IMAGE_TARGETS.includes(targetType as (typeof IMAGE_TARGETS)[number])) {
    return fail(`invalid_argument: target_type must be one of: ${IMAGE_TARGETS.join(", ")}.`);
  }

  const imageType = readString(input, "image_type") ?? "large";

  let path: string;
  if (targetType === "subject") {
    const targetId = readNumber(input, "target_id");
    if (targetId === undefined) return fail("target_id is required for subject images.");
    path = `/v0/subjects/${targetId}/image`;
  } else if (targetType === "person") {
    const targetId = readNumber(input, "target_id");
    if (targetId === undefined) return fail("target_id is required for person images.");
    path = `/v0/persons/${targetId}/image`;
  } else if (targetType === "character") {
    const targetId = readNumber(input, "target_id");
    if (targetId === undefined) return fail("target_id is required for character images.");
    path = `/v0/characters/${targetId}/image`;
  } else {
    const username = readString(input, "username");
    if (!username) return fail("username is required for user avatar.");
    path = `/v0/users/${username}/avatar`;
  }

  const result = await api(context, "GET", path, { type: imageType });
  if (result.ok && result.location) {
    return ok(`${targetType} image URL (${imageType}): ${result.location}`);
  }
  if (!result.ok) {
    return fail(formatBangumiFailure(result));
  }
  return fail(`Could not retrieve image for ${targetType}.`);
}

async function runSearch(input: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
  const keyword = readString(input, "keyword");
  if (!keyword) {
    return fail("keyword is required.");
  }

  const scope = readString(input, "scope") ?? "all";
  if (!SEARCH_SCOPES.includes(scope as (typeof SEARCH_SCOPES)[number])) {
    return fail(`scope must be one of: ${SEARCH_SCOPES.join(", ")}.`);
  }

  const [subjectResult, personResult, characterResult] = await Promise.all([
    scope === "all" || scope === "subject" ? searchSubjects(input, context) : Promise.resolve(undefined),
    scope === "all" || scope === "person" ? searchPersons(input, context) : Promise.resolve(undefined),
    scope === "all" || scope === "character" ? searchCharacters(input, context) : Promise.resolve(undefined),
  ]);

  if (scope !== "all") {
    const result = subjectResult ?? personResult ?? characterResult;
    if (!result) {
      return ok(`No results for "${keyword}".`);
    }
    return result;
  }

  return ok(
    prettyJson({
      keyword,
      subject: subjectResult ? toSearchSection(subjectResult) : undefined,
      person: personResult ? toSearchSection(personResult) : undefined,
      character: characterResult ? toSearchSection(characterResult) : undefined,
    }),
  );
}

function buildCalendarTool(): ToolDefinition {
  return {
    name: "get_calendar",
    description: "Get Bangumi's weekly broadcast schedule.",
    inputSchema: schemaObject({}),
    handler: async (_, context) => apiCalendar(context),
  };
}

function buildSearchTool(): ToolDefinition {
  return {
    name: "search",
    description: "Search Bangumi subjects, persons, or characters in one call. Use scope=all|subject|person|character.",
    inputSchema: schemaObject(
      {
        keyword: schemaString("Keyword"),
        scope: schemaString("Search scope", SEARCH_SCOPES),
        subject_type: schemaInteger("Subject type", { enum: [1, 2, 3, 4, 6] }),
        subject_sort: schemaString("Subject sort", SUBJECT_SORTS),
        career_filter: schemaArray(schemaString("Career", PERSON_CAREERS), "Career list"),
        nsfw_filter: schemaBoolean("NSFW filter"),
        limit: schemaInteger("Limit", { minimum: 1, maximum: 20, default: 10 }),
        offset: schemaInteger("Offset", { minimum: 0, default: 0 }),
      },
      ["keyword"],
    ),
    handler: runSearch,
  };
}

function buildSubjectTool(): ToolDefinition {
  return {
    name: "get_subject",
    description: `Get Bangumi subject details.
Use include to fetch extra data in the same call:
- "persons" (staff/cast)
- "characters"
- "relations" (sequels, prequels, and related entries)
- "episodes"
Example: include=["persons","episodes"] fetches both staff/cast and episode list.
Partial include failures are returned as _error fields instead of failing the whole call.`,
    inputSchema: schemaObject(
      {
        subject_id: schemaInteger("Subject ID", { minimum: 1 }),
        include: schemaArray(schemaString("Include", ["persons", "characters", "relations", "episodes"]), "Include related data"),
        episode_limit: schemaInteger("Episode limit", { minimum: 1, maximum: 200, default: 100 }),
        episode_offset: schemaInteger("Episode offset", { minimum: 0, default: 0 }),
        episode_type: schemaInteger("Episode type filter", { enum: [0, 1, 2, 3, 4, 5, 6] }),
      },
      ["subject_id"],
    ),
    handler: getSubject,
  };
}

function buildUserTool(): ToolDefinition {
  return {
    name: "get_user",
    description: "Get Bangumi user profile plus a collection snapshot. Profile and collection data are returned separately and can carry _error markers independently.",
    inputSchema: schemaObject({
      username: schemaString("Username"),
      collection_limit: schemaInteger("Collection limit", { minimum: 1, maximum: 50, default: 50 }),
      collection_offset: schemaInteger("Collection offset", { minimum: 0, default: 0 }),
      subject_type: schemaInteger("Subject type filter", { enum: [1, 2, 3, 4, 6] }),
      collection_type: schemaInteger("Collection type filter", { enum: [1, 2, 3, 4, 5] }),
      subject_id: schemaInteger("Single subject ID for detailed collection lookup", { minimum: 1 }),
    }),
    handler: getUser,
  };
}

function buildUpdateCollectionTool(): ToolDefinition {
  return {
    name: "update_collection",
    description: "Update Bangumi collections. target_type values: subject (subject_status/progress/rating/comment), person (favorite), character (favorite), episode (episode_status for single), episode_batch (subject_id+episode_ids+episode_status for batch).",
    requiresAuth: true,
    inputSchema: schemaObject({
      target_type: schemaString("Target type", UPDATE_TARGET_TYPES),
      subject_id: schemaInteger("Subject ID", { minimum: 1 }),
      character_id: schemaInteger("Character ID", { minimum: 1 }),
      person_id: schemaInteger("Person ID", { minimum: 1 }),
      episode_id: schemaInteger("Episode ID", { minimum: 1 }),
      episode_ids: schemaArray(schemaInteger("Episode ID", { minimum: 1 }), "Episode ID list"),
      subject_status: schemaString("Subject status", SUBJECT_STATUS_VALUES),
      episode_status: schemaInteger("Episode status", { enum: [1, 2, 3] }),
      progress: schemaObject({
        episodes_watched: schemaInteger("Episodes watched", { minimum: 0 }),
        volumes_read: schemaInteger("Volumes read", { minimum: 0 }),
      }),
      favorite: schemaBoolean("Favorite"),
      rating: schemaInteger("Rating", { minimum: 0, maximum: 10 }),
      comment: schemaString("Comment"),
    }, ["target_type"]),
    handler: updateCollection,
  };
}

function buildPersonTool(): ToolDefinition {
  return {
    name: "get_person",
    description: "Get Bangumi person details plus works and roles. The returned payload keeps profile, subjects, and characters separate and can mark each section with _error.",
    inputSchema: schemaObject({ person_id: schemaInteger("Person ID", { minimum: 1 }) }, ["person_id"]),
    handler: getPerson,
  };
}

function buildCharacterTool(): ToolDefinition {
  return {
    name: "get_character",
    description: "Get Bangumi character details plus appearances and voice actors. The returned payload keeps profile, subjects, and persons separate and can mark each section with _error.",
    inputSchema: schemaObject({ character_id: schemaInteger("Character ID", { minimum: 1 }) }, ["character_id"]),
    handler: getCharacter,
  };
}

function buildManageIndexTool(): ToolDefinition {
  return {
    name: "manage_index",
    description: "Create, get, update, list_subjects, add_subject, update_subject, remove_subject, collect, and uncollect Bangumi indices. This tool is hidden unless BANGUMI_ENABLE_INDEX_TOOLS is enabled.",
    requiresAuth: true,
    inputSchema: schemaObject({
      action: schemaString("Action", INDEX_ACTIONS),
      index_id: schemaInteger("Index ID", { minimum: 1 }),
      subject_id: schemaInteger("Subject ID", { minimum: 1 }),
      title: schemaString("Title"),
      description: schemaString("Description"),
      comment: schemaString("Comment"),
      subject_type: schemaInteger("Subject type", { enum: [1, 2, 3, 4, 6] }),
      limit: schemaInteger("Limit", { minimum: 1, maximum: 50, default: 30 }),
      offset: schemaInteger("Offset", { minimum: 0, default: 0 }),
    }, ["action"]),
    handler: manageIndex,
  };
}

function buildBrowseSubjectsTool(): ToolDefinition {
  return {
    name: "browse_subjects",
    description: "Browse Bangumi subjects by type with optional filters (category, year, month, platform, series, sort). Required: subject_type (1=Book, 2=Anime, 3=Music, 4=Game, 6=Real).",
    inputSchema: schemaObject({
      subject_type: schemaInteger("Subject type", { enum: [1, 2, 3, 4, 6] }),
      cat: schemaInteger("Category filter"),
      series: schemaBoolean("Series filter (books)"),
      platform: schemaString("Platform filter (games)"),
      sort: schemaString("Sort order", BROWSE_SORTS),
      year: schemaInteger("Year filter"),
      month: schemaInteger("Month filter", { minimum: 1, maximum: 12 }),
      limit: schemaInteger("Limit", { minimum: 1, maximum: 50, default: 30 }),
      offset: schemaInteger("Offset", { minimum: 0, default: 0 }),
    }, ["subject_type"]),
    handler: browseSubjects,
  };
}

function buildGetCollectionsTool(): ToolDefinition {
  return {
    name: "get_collections",
    description: "Get Bangumi person/character collection lists or individual collection details. Use target_type=person|character with username. Pass person_id or character_id for individual lookup.",
    inputSchema: schemaObject({
      target_type: schemaString("Collection target", COLLECTION_TARGETS),
      username: schemaString("Username"),
      person_id: schemaInteger("Person ID for individual lookup", { minimum: 1 }),
      character_id: schemaInteger("Character ID for individual lookup", { minimum: 1 }),
      limit: schemaInteger("Limit", { minimum: 1, maximum: 50, default: 30 }),
      offset: schemaInteger("Offset", { minimum: 0, default: 0 }),
    }, ["target_type", "username"]),
    handler: getCollections,
  };
}

function buildGetEpisodeTool(): ToolDefinition {
  return {
    name: "get_episode",
    description: "Get Bangumi episode details or episode collection status. episode_id alone = details. episode_id + collection=true = single collection. subject_id + collection=true = collection list.",
    inputSchema: schemaObject({
      episode_id: schemaInteger("Episode ID", { minimum: 1 }),
      subject_id: schemaInteger("Subject ID for collection list", { minimum: 1 }),
      episode_type: schemaInteger("Episode type filter", { enum: [0, 1, 2, 3, 4, 5, 6] }),
      collection: schemaBoolean("Set true to query collection status"),
      limit: schemaInteger("Limit", { minimum: 1, maximum: 200, default: 100 }),
      offset: schemaInteger("Offset", { minimum: 0, default: 0 }),
    }),
    handler: getEpisode,
  };
}

function buildGetImageTool(): ToolDefinition {
  return {
    name: "get_image",
    description: "Get image URL for subject/person/character/user. Returns the redirect location URL for the requested image type. target_type=subject|person|character requires target_id; target_type=user requires username.",
    inputSchema: schemaObject({
      target_type: schemaString("Image target", IMAGE_TARGETS),
      target_id: schemaInteger("Subject/Person/Character ID", { minimum: 1 }),
      username: schemaString("Username (for user avatar)"),
      image_type: schemaString("Image type", IMAGE_TYPES),
    }, ["target_type"]),
    handler: getImage,
  };
}

function buildResourceList(): ResourceDefinition[] {
  return [
    {
      uri: "bangumi://openapi",
      name: "OpenAPI",
      description: "Bangumi OpenAPI spec.",
      mimeType: "application/json",
      read: async () => prettyJson(openapiSpec),
    },
  ];
}

export function createToolRegistry(config: RuntimeConfig): { toolList: ToolEntry[]; toolMap: Map<string, ToolDefinition> } {
  const tools: ToolDefinition[] = [
    buildSearchTool(),
    buildSubjectTool(),
    buildUserTool(),
    buildCalendarTool(),
    buildUpdateCollectionTool(),
    buildBrowseSubjectsTool(),
    buildGetCollectionsTool(),
    buildGetEpisodeTool(),
    buildGetImageTool(),
  ];

  if (config.enableIndexTools) {
    tools.push(buildManageIndexTool());
  }

  tools.push(
    buildPersonTool(),
    buildCharacterTool(),
  );

  return {
    toolList: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    toolMap: new Map<string, ToolDefinition>(tools.map((tool) => [tool.name, tool] as const)),
  };
}

export const resources = buildResourceList();
export const resourceList: ResourceEntry[] = resources.map((resource) => ({
  uri: resource.uri,
  name: resource.name,
  description: resource.description,
  mimeType: resource.mimeType,
}));
export const resourceMap = new Map<string, ResourceDefinition>(resources.map((resource) => [resource.uri, resource] as const));
