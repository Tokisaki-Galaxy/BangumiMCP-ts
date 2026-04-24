export interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: {
    type: "text";
    text: string;
  };
}

export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments?: PromptArgument[];
  messages: PromptMessage[];
}

export const promptList: Array<Pick<PromptDefinition, "name" | "title" | "description" | "arguments">> = [
  {
    name: "bangumi-usage",
    title: "Bangumi Usage Hints",
    description: "Short guidance for using this Bangumi MCP.",
  },
];

export const promptMap = new Map<string, PromptDefinition>([
  [
    "bangumi-usage",
    {
      name: "bangumi-usage",
      title: "Bangumi Usage Hints",
      description: "Short guidance for using this Bangumi MCP.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "This MCP exposes a compact Bangumi surface.",
              "Use search first, then get_subject/get_person/get_character/get_user.",
              "Use get_subject with include=[\"persons\",\"characters\",\"relations\",\"episodes\"] when you need expanded data in one call.",
              "get_subject/get_person/get_character/get_user may return partial payloads with _error markers instead of failing the whole request.",
              "Use get_calendar for broadcast schedules.",
              "Use update_collection with strict target_type validation; subject targets accept subject_status/progress/rating/comment, while person/character targets accept favorite only.",
              "Use manage_index only when enabled.",
              "Keep requests paginated and small.",
            ].join(" "),
          },
        },
      ],
    },
  ],
]);
