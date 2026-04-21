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
              "This MCP serves Bangumi API access.",
              "Prefer read-only tools first.",
              "Use Authorization: Bearer for write tools.",
              "Keep requests paginated and small.",
            ].join(" "),
          },
        },
      ],
    },
  ],
]);
