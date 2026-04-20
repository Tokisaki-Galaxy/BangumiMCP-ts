const SUBJECT_TYPES: Record<number, string> = {
  1: "Book",
  2: "Anime",
  3: "Music",
  4: "Game",
  6: "Real",
};

const PERSON_TYPES: Record<number, string> = {
  1: "Individual",
  2: "Corporation",
  3: "Association",
};

const CHARACTER_TYPES: Record<number, string> = {
  1: "Character",
  2: "Mechanic",
  3: "Ship",
  4: "Organization",
};

const EPISODE_TYPES: Record<number, string> = {
  0: "MainStory",
  1: "SP",
  2: "OP",
  3: "ED",
  4: "PV",
  5: "MAD",
  6: "Other",
};

const COLLECTION_TYPES: Record<number, string> = {
  1: "Wish",
  2: "Collected",
  3: "Doing",
  4: "On Hold",
  5: "Dropped",
};

const EPISODE_COLLECTION_TYPES: Record<number, string> = {
  1: "Wish",
  2: "Done",
  3: "Dropped",
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getName(record: Record<string, unknown>): string {
  return (
    getString(record.name_cn) ??
    getString(record.name) ??
    getString(record.title) ??
    "Unknown"
  );
}

function getTypeName(typeValue: unknown, mapping: Record<number, string>): string {
  const value = getNumber(typeValue);
  if (value === undefined) {
    return "Unknown";
  }

  return mapping[value] ?? `Unknown (${value})`;
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function formatSubjectSummary(subject: Record<string, unknown>): string {
  const parts = [
    `ID: ${getNumber(subject.id) ?? "?"}`,
    `Name: ${getName(subject)}`,
    `Type: ${getTypeName(subject.type, SUBJECT_TYPES)}`,
  ];

  const date = getString(subject.date);
  if (date) {
    parts.push(`Date: ${date}`);
  }

  const score = subject.rating && typeof subject.rating === "object"
    ? getNumber((subject.rating as Record<string, unknown>).score)
    : undefined;
  const rank = subject.rating && typeof subject.rating === "object"
    ? getNumber((subject.rating as Record<string, unknown>).rank)
    : undefined;

  if (score !== undefined) {
    parts.push(`Score: ${score}`);
  }
  if (rank !== undefined) {
    parts.push(`Rank: ${rank}`);
  }

  const image = subject.images && typeof subject.images === "object"
    ? getString((subject.images as Record<string, unknown>).large)
    : undefined;
  if (image) {
    parts.push(`Image: ${image}`);
  }

  return parts.join(" | ");
}

export function formatPersonSummary(person: Record<string, unknown>): string {
  const careers = Array.isArray(person.career)
    ? person.career
        .map((item) => (typeof item === "string" ? item : String(item)))
        .filter((item) => item.length > 0)
        .join(", ")
    : "";

  const parts = [
    `ID: ${getNumber(person.id) ?? "?"}`,
    `Name: ${getName(person)}`,
    `Type: ${getTypeName(person.type, PERSON_TYPES)}`,
  ];

  if (careers) {
    parts.push(`Careers: ${careers}`);
  }

  const image = person.images && typeof person.images === "object"
    ? getString((person.images as Record<string, unknown>).large)
    : undefined;
  if (image) {
    parts.push(`Image: ${image}`);
  }

  return parts.join(" | ");
}

export function formatCharacterSummary(character: Record<string, unknown>): string {
  const parts = [
    `ID: ${getNumber(character.id) ?? "?"}`,
    `Name: ${getName(character)}`,
    `Type: ${getTypeName(character.type, CHARACTER_TYPES)}`,
  ];

  const gender = getString(character.gender);
  if (gender) {
    parts.push(`Gender: ${gender}`);
  }

  const image = character.images && typeof character.images === "object"
    ? getString((character.images as Record<string, unknown>).large)
    : undefined;
  if (image) {
    parts.push(`Image: ${image}`);
  }

  return parts.join(" | ");
}

export function formatEpisodeSummary(episode: Record<string, unknown>): string {
  const parts = [
    `ID: ${getNumber(episode.id) ?? "?"}`,
    `Name: ${getName(episode)}`,
    `Type: ${getTypeName(episode.type, EPISODE_TYPES)}`,
  ];

  const sort = getNumber(episode.sort);
  if (sort !== undefined) {
    parts.push(`Number: ${sort}`);
  }

  const airdate = getString(episode.airdate);
  if (airdate) {
    parts.push(`Airdate: ${airdate}`);
  }

  return parts.join(" | ");
}

export function formatRevisionSummary(revision: Record<string, unknown>): string {
  const creator = revision.creator && typeof revision.creator === "object"
    ? (revision.creator as Record<string, unknown>)
    : undefined;
  const createdBy = creator
    ? getString(creator.username) ?? getString(creator.nickname) ?? getString(creator.name)
    : undefined;

  const parts = [
    `ID: ${getNumber(revision.id) ?? "?"}`,
    `Summary: ${getString(revision.summary) ?? "No summary"}`,
  ];

  if (createdBy) {
    parts.push(`Creator: ${createdBy}`);
  }

  const createdAt = getString(revision.created_at);
  if (createdAt) {
    parts.push(`Created at: ${createdAt}`);
  }

  return parts.join(" | ");
}

export function formatCollectionStatus(value: unknown): string {
  const numberValue = getNumber(value);
  if (numberValue === undefined) {
    return "Unknown";
  }

  return COLLECTION_TYPES[numberValue] ?? `Unknown (${numberValue})`;
}

export function formatEpisodeCollectionStatus(value: unknown): string {
  const numberValue = getNumber(value);
  if (numberValue === undefined) {
    return "Unknown";
  }

  return EPISODE_COLLECTION_TYPES[numberValue] ?? `Unknown (${numberValue})`;
}

export function formatItemList(title: string, items: string[], total?: number): string {
  const lines = [title];
  if (typeof total === "number") {
    lines.push(`Total: ${total}`);
  }
  if (items.length === 0) {
    lines.push("No items found.");
  } else {
    lines.push(items.join("\n---\n"));
  }
  return lines.join("\n");
}
