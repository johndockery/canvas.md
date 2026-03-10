import Anthropic from "@anthropic-ai/sdk";

const CANVAS_API =
  process.env.CANVAS_INTERNAL_API_URL ||
  (process.env.NODE_ENV === "production"
    ? `http://localhost:${process.env.PORT || 8080}`
    : "http://localhost:1235");

// --- Tool definitions (Anthropic tool schema format) ---

export const GITHUB_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_directory",
    description:
      "List files and directories at a path in a GitHub repo. Use path='' for the root directory.",
    input_schema: {
      type: "object" as const,
      properties: {
        repo: {
          type: "string",
          description: "Repository in owner/repo format",
        },
        path: {
          type: "string",
          description: "Directory path (empty string for root)",
        },
      },
      required: ["repo"],
    },
  },
  {
    name: "read_file",
    description:
      "Read the contents of a file from a GitHub repo. Returns up to 10,000 characters.",
    input_schema: {
      type: "object" as const,
      properties: {
        repo: {
          type: "string",
          description: "Repository in owner/repo format",
        },
        path: {
          type: "string",
          description: "File path within the repository",
        },
      },
      required: ["repo", "path"],
    },
  },
  {
    name: "search_code",
    description:
      "Search for code in a GitHub repo. Returns up to 5 matching file paths.",
    input_schema: {
      type: "object" as const,
      properties: {
        repo: {
          type: "string",
          description: "Repository in owner/repo format",
        },
        query: {
          type: "string",
          description: "Code search query",
        },
      },
      required: ["repo", "query"],
    },
  },
];

// --- Tool executor ---

export async function executeGitHubTool(
  toolName: string,
  input: Record<string, string>,
  cookieHeader: string
): Promise<string> {
  try {
    const repo = input.repo || "";
    const [owner, repoName] = repo.split("/");
    if (!owner || !repoName) {
      return "Error: repo must be in owner/repo format";
    }

    let url: string;
    switch (toolName) {
      case "list_directory": {
        const dirPath = input.path || "";
        url = `${CANVAS_API}/api/canvas/github/browse/${owner}/${repoName}/tree?path=${encodeURIComponent(dirPath)}`;
        break;
      }
      case "read_file": {
        const filePath = input.path || "";
        if (!filePath) return "Error: path is required";
        url = `${CANVAS_API}/api/canvas/github/browse/${owner}/${repoName}/file?path=${encodeURIComponent(filePath)}`;
        break;
      }
      case "search_code": {
        const query = input.query || "";
        if (!query) return "Error: query is required";
        url = `${CANVAS_API}/api/canvas/github/browse/${owner}/${repoName}/search?q=${encodeURIComponent(query)}`;
        break;
      }
      default:
        return `Error: unknown tool ${toolName}`;
    }

    const res = await fetch(url, {
      headers: { Cookie: cookieHeader },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return `Error: ${(err as { error?: string }).error || res.statusText}`;
    }

    const data = await res.json();
    return JSON.stringify(data, null, 2);
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

// --- Agentic loop ---

export interface AgentResult {
  text: string;
  toolCall?: {
    name: string;
    input: Record<string, unknown>;
  };
}

export async function runAgentLoop(options: {
  anthropic: Anthropic;
  systemPrompt: string;
  userMessage: string;
  tools: Anthropic.Tool[];
  cookieHeader: string;
  maxTurns?: number;
  /** Tool names that should end the loop when called (e.g. "apply_edits") */
  terminalTools?: string[];
  /** Pre-built message history for multi-turn conversations (overrides userMessage) */
  initialMessages?: Anthropic.MessageParam[];
  /** Called before each tool execution with tool name and input */
  onProgress?: (event: { tool: string; input: Record<string, string> }) => void;
  /** Called with incremental edit data as apply_edits tool input streams in */
  onEditStream?: (data: { editIndex: number; originalText: string; delta: string }) => void;
  /** AbortSignal to cancel the loop (e.g. when client disconnects) */
  signal?: AbortSignal;
}): Promise<AgentResult> {
  const {
    anthropic,
    systemPrompt,
    userMessage,
    tools,
    cookieHeader,
    maxTurns = 200,
    terminalTools = [],
  } = options;

  const messages: Anthropic.MessageParam[] = options.initialMessages
    ? [...options.initialMessages]
    : [{ role: "user", content: userMessage }];

  for (let turn = 0; turn < maxTurns; turn++) {
    if (options.signal?.aborted) {
      return { text: "Request was cancelled." };
    }

    const apiStream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      tool_choice: { type: "auto" },
      messages,
    });

    const sentLengths: number[] = [];
    apiStream.on("inputJson", (_partial: string, snapshot: unknown) => {
      const snap = snapshot as { edits?: Array<{ original_text?: string; new_text?: string }> };
      if (!snap.edits) return;
      for (let i = 0; i < snap.edits.length; i++) {
        const edit = snap.edits[i];
        if (!edit?.new_text) continue;
        const prev = sentLengths[i] || 0;
        if (edit.new_text.length > prev) {
          options.onEditStream?.({
            editIndex: i,
            originalText: edit.original_text ?? "",
            delta: edit.new_text.slice(prev),
          });
          sentLengths[i] = edit.new_text.length;
        }
      }
    });

    const response = await apiStream.finalMessage();

    // Check if response is a pure text response (end_turn or no tool blocks)
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      // No terminal tools expected — return text as-is
      if (terminalTools.length === 0) {
        return { text };
      }

      // Terminal tools expected but agent responded with text.
      // Force a follow-up call with the terminal tool required.
      console.log("[agent-loop] Agent responded with text instead of terminal tool. Forcing follow-up. Text:", text.substring(0, 200));
      const terminalToolDefs = tools.filter((t) => terminalTools.includes(t.name));

      // Try approach 1: full message history with forced tool call
      try {
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `You MUST call the ${terminalTools[0]} tool now with actual content. Do NOT respond with text. Take your findings and put them into the document by calling ${terminalTools[0]} with a non-empty edits array. Each edit must have original_text (use "" for empty document) and new_text with the actual content.`,
        });

        const forcedStream = anthropic.messages.stream({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16384,
          system: systemPrompt,
          tools: terminalToolDefs,
          tool_choice: { type: "tool" as const, name: terminalTools[0] },
          messages,
        });

        const forcedSentLengths: number[] = [];
        forcedStream.on("inputJson", (_partial: string, snapshot: unknown) => {
          const snap = snapshot as { edits?: Array<{ original_text?: string; new_text?: string }> };
          if (!snap.edits) return;
          for (let i = 0; i < snap.edits.length; i++) {
            const edit = snap.edits[i];
            if (!edit?.new_text) continue;
            const prev = forcedSentLengths[i] || 0;
            if (edit.new_text.length > prev) {
              options.onEditStream?.({
                editIndex: i,
                originalText: edit.original_text ?? "",
                delta: edit.new_text.slice(prev),
              });
              forcedSentLengths[i] = edit.new_text.length;
            }
          }
        });

        const forced = await forcedStream.finalMessage();

        const toolBlock = forced.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
        );
        if (toolBlock) {
          console.log("[agent-loop] Forced follow-up produced tool call:", toolBlock.name);
          const forcedText = forced.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("");
          return {
            text: forcedText || text,
            toolCall: { name: toolBlock.name, input: toolBlock.input as Record<string, unknown> },
          };
        }
        console.warn("[agent-loop] Forced follow-up did not produce a tool call");
      } catch (err) {
        console.error("[agent-loop] Forced follow-up with full history failed:", err);
      }

      // Try approach 2: condensed message with original user instruction
      // (avoids token limit from huge repo exploration history)
      try {
        console.log("[agent-loop] Trying condensed forced call with original instruction + agent findings");
        const condensedStream = anthropic.messages.stream({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16384,
          system: systemPrompt,
          tools: terminalToolDefs,
          tool_choice: { type: "tool" as const, name: terminalTools[0] },
          messages: [
            {
              role: "user",
              content: `${userMessage}\n\n---\n\nAfter exploring, here is what the assistant found:\n\n${text}\n\nNow you MUST call ${terminalTools[0]} to write comprehensive, well-structured content into the document. Use original_text: "" (empty string) if the document is empty. Put thorough, detailed content in new_text using markdown formatting. The edits array MUST NOT be empty.`,
            },
          ],
        });

        const condensedSentLengths: number[] = [];
        condensedStream.on("inputJson", (_partial: string, snapshot: unknown) => {
          const snap = snapshot as { edits?: Array<{ original_text?: string; new_text?: string }> };
          if (!snap.edits) return;
          for (let i = 0; i < snap.edits.length; i++) {
            const edit = snap.edits[i];
            if (!edit?.new_text) continue;
            const prev = condensedSentLengths[i] || 0;
            if (edit.new_text.length > prev) {
              options.onEditStream?.({
                editIndex: i,
                originalText: edit.original_text ?? "",
                delta: edit.new_text.slice(prev),
              });
              condensedSentLengths[i] = edit.new_text.length;
            }
          }
        });

        const condensed = await condensedStream.finalMessage();
        const condensedToolBlock = condensed.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
        );
        if (condensedToolBlock) {
          console.log("[agent-loop] Condensed forced call produced tool call:", condensedToolBlock.name);
          return {
            text,
            toolCall: { name: condensedToolBlock.name, input: condensedToolBlock.input as Record<string, unknown> },
          };
        }
        console.warn("[agent-loop] Condensed forced call also did not produce a tool call");
      } catch (err2) {
        console.error("[agent-loop] Condensed forced call also failed:", err2);
      }

      return { text };
    }

    // Check if any tool call is a terminal tool
    const terminalCall = toolUseBlocks.find((b) =>
      terminalTools.includes(b.name)
    );
    if (terminalCall) {
      // Check if apply_edits was called with empty edits — if so, don't treat as terminal
      const terminalInput = terminalCall.input as Record<string, unknown>;
      const editsArray = terminalInput.edits as unknown[] | undefined;
      if (terminalCall.name === "apply_edits" && (!editsArray || editsArray.length === 0)) {
        console.warn("[agent-loop] apply_edits called with empty edits, forcing retry");
        // Send tool result and continue the loop so it tries again
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: terminalCall.id,
              content: "Error: edits array is empty. You MUST include at least one edit with original_text and new_text containing the actual document content. Try again with a non-empty edits array.",
            },
          ],
        });
        continue;
      }

      // Extract any text that came before the tool call
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return {
        text,
        toolCall: {
          name: terminalCall.name,
          input: terminalCall.input as Record<string, unknown>,
        },
      };
    }

    // Execute GitHub tool calls in parallel, build tool_result messages
    messages.push({ role: "assistant", content: response.content });

    // Fire all progress callbacks first
    for (const block of toolUseBlocks) {
      options.onProgress?.({ tool: block.name, input: block.input as Record<string, string> });
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const result = await executeGitHubTool(
          block.name,
          block.input as Record<string, string>,
          cookieHeader
        );
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: result,
        };
      })
    );
    messages.push({ role: "user", content: toolResults });
  }

  // Max turns reached — give the model one final turn to produce results.
  console.log("[agent-loop] Max turns reached, forcing final result");
  const terminalToolDefs = terminalTools.length > 0
    ? tools.filter((t) => terminalTools.includes(t.name))
    : [];

  const hasTerminalTools = terminalToolDefs.length > 0;

  messages.push({
    role: "user",
    content: hasTerminalTools
      ? "You have reached the maximum number of exploration steps. You MUST now call the apply_edits tool with your findings. Put ALL gathered information into the document via apply_edits with a non-empty edits array. Use original_text: \"\" if the document is empty. Do NOT call any exploration tools. Do NOT respond with text only."
      : "You have reached the maximum number of tool-use steps. Please provide your final answer now based on everything you have found so far. Do NOT call any more tools.",
  });

  try {
    const finalStream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16384,
      system: systemPrompt,
      ...(hasTerminalTools
        ? { tools: terminalToolDefs, tool_choice: { type: "auto" as const } }
        : {}),
      messages,
    });

    const finalSentLengths: number[] = [];
    finalStream.on("inputJson", (_partial: string, snapshot: unknown) => {
      const snap = snapshot as { edits?: Array<{ original_text?: string; new_text?: string }> };
      if (!snap.edits) return;
      for (let i = 0; i < snap.edits.length; i++) {
        const edit = snap.edits[i];
        if (!edit?.new_text) continue;
        const prev = finalSentLengths[i] || 0;
        if (edit.new_text.length > prev) {
          options.onEditStream?.({
            editIndex: i,
            originalText: edit.original_text ?? "",
            delta: edit.new_text.slice(prev),
          });
          finalSentLengths[i] = edit.new_text.length;
        }
      }
    });

    const finalResponse = await finalStream.finalMessage();

    // Extract terminal tool call from forced final turn
    if (hasTerminalTools) {
      const toolUseBlock = finalResponse.content.find(
        (b): b is Anthropic.ToolUseBlock =>
          b.type === "tool_use" && terminalTools.includes(b.name)
      );
      if (toolUseBlock) {
        const text = finalResponse.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        return {
          text,
          toolCall: {
            name: toolUseBlock.name,
            input: toolUseBlock.input as Record<string, unknown>,
          },
        };
      }
    }

    const text = finalResponse.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text) return { text };
  } catch {
    // Fall through to generic message
  }

  return { text: "I explored the repository but reached the maximum number of steps before finishing." };
}
